/**
 * iOS HarnessBackground.metal 的逐像素移植（TaskPool 低分辨率渲染，主线程只缩放位图）。
 * 与 iOS `harnessFluid` 使用完全相同的 hash / noise / FBM / 色彩混合与丝带公式。
 */
class FluidField {
  private fract(value: number): number {
    return value - Math.floor(value);
  }

  private mix(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /** 与 Metal smoothstep(e0,e1,x) 一致（e0>e1 时同样成立） */
  private smoothstep(e0: number, e1: number, value: number): number {
    const t: number = Math.max(0, Math.min(1, (value - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  private hash(x: number, y: number): number {
    let px: number = this.fract(x * 123.34);
    let py: number = this.fract(y * 456.21);
    const dot: number = px * (px + 45.32) + py * (py + 45.32);
    px += dot;
    py += dot;
    return this.fract(px * py);
  }

  private noise(x: number, y: number): number {
    const ix: number = Math.floor(x);
    const iy: number = Math.floor(y);
    const fx: number = this.fract(x);
    const fy: number = this.fract(y);
    const ux: number = fx * fx * (3 - 2 * fx);
    const uy: number = fy * fy * (3 - 2 * fy);
    return this.mix(
      this.mix(this.hash(ix, iy), this.hash(ix + 1, iy), ux),
      this.mix(this.hash(ix, iy + 1), this.hash(ix + 1, iy + 1), ux),
      uy
    );
  }

  private fbm(x: number, y: number): number {
    let value: number = 0;
    let amplitude: number = 0.56;
    for (let octave = 0; octave < 4; octave++) {
      value += amplitude * this.noise(x, y);
      // Metal float2x2(0.80,-0.60,0.60,0.80) 为列主序：x'=0.8x+0.6y，y'=-0.6x+0.8y
      const nx: number = (0.80 * x + 0.60 * y) * 2.03 + 17.17;
      const ny: number = (-0.60 * x + 0.80 * y) * 2.03 + 17.17;
      x = nx;
      y = ny;
      amplitude *= 0.46;
    }
    return value;
  }

  render(width: number, height: number, aspect: number, seconds: number, wide: boolean): ArrayBuffer {
    const bytes = new Uint8ClampedArray(width * height * 4);
    const t: number = seconds * 0.075;
    const black: number[] = [0.002, 0.008, 0.018];
    const deepBlue: number[] = [0.102, 0.220, 0.439];
    const oceanBlue: number[] = [0.125, 0.290, 0.494];
    const mistBlue: number[] = [0.325, 0.553, 0.790];
    const warmLight: number[] = [0.933, 0.847, 0.667];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const uvx: number = (x + 0.5) / width;
        const uvy: number = (y + 0.5) / height;
        const px: number = uvx * aspect * 2.05 - 0.30;
        const py: number = uvy * 2.05 - 0.08;
        const qx: number = this.fbm(px * 0.62, py * 0.62 + t);
        const qy: number = this.fbm(px * 0.62 + 5.2, py * 0.62 + 1.3 - t);
        const rx: number = this.fbm(px * 0.72 + qx * 0.62 + 1.7, py * 0.72 + qy * 0.62 + 3.1 + t * 0.7);
        const ry: number = this.fbm(px * 0.72 + qx * 0.62 + 9.2, py * 0.72 + qy * 0.62 + 5.7 - t * 0.65);
        const fluid: number = this.fbm((px + qx * 0.76 + rx * 0.52) * 0.72 + t * 0.25,
          (py + qy * 0.76 + ry * 0.52) * 0.72 + t * 0.25);
        const swirl: number = this.noise(px * 1.25 + rx * 2.1 - t * 0.42, py * 1.25 + ry * 2.1 - t * 0.42);

        const warpedX: number = uvx * aspect + (qx - 0.5) * 0.085 + (rx - 0.5) * 0.045;
        const warpedY: number = uvy + (qy - 0.5) * 0.085 + (ry - 0.5) * 0.045;
        const radiusA: number = Math.hypot(warpedX - aspect * 0.58, warpedY - 0.16);
        const radiusB: number = Math.hypot(warpedX + aspect * 0.20, warpedY - 0.13);
        const ribbonA: number = Math.exp(-Math.pow((radiusA - (0.35 + 0.025 * Math.sin(t * 1.5))) / 0.042, 2));
        // 半径略放大：让第二条丝带扫过右下角（iOS 观感中的右下光带）
        const ribbonB: number = Math.exp(-Math.pow((radiusB - (0.98 + 0.020 * Math.cos(t * 1.15))) / 0.075, 2));
        const ribbon: number = Math.max(0, Math.min(1, ribbonA * 0.78 + ribbonB * 0.62));
        const glow: number = this.smoothstep(0.90, 0.18, Math.hypot((uvx - 0.58) * 0.82, uvy - 0.32));
        const vignette: number = this.smoothstep(0.95, 0.23, Math.hypot((uvx - 0.5) * 0.86, uvy - 0.5));
        const grain: number = (this.hash(x + Math.floor(seconds * 12), y + Math.floor(seconds * 12)) - 0.5) * 0.010;

        const offset: number = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          let color: number = this.mix(black[c], deepBlue[c], this.smoothstep(0.14, 0.63, fluid));
          color = this.mix(color, oceanBlue[c], this.smoothstep(0.42, 0.82, fluid + swirl * 0.18));
          color = this.mix(color, mistBlue[c], this.smoothstep(0.74, 0.98, swirl) * 0.18);
          color = this.mix(color, warmLight[c], ribbon * (0.56 + 0.24 * swirl));
          color += deepBlue[c] * glow * 0.22;
          color *= 0.38 + 0.72 * vignette;
          color += grain;
          bytes[offset + c] = Math.max(0, color) * 255;
        }
        bytes[offset + 3] = 255;
      }
    }
    return bytes.buffer;
  }
}

export function renderBrandFlow(width: number, height: number, aspect: number, seconds: number, wide: boolean): ArrayBuffer {
  return new FluidField().render(width, height, aspect, seconds, wide);
}
