/**
 * 运行状态外观（对齐小程序 styles/status-tail-animation.wxss 生成的色板）。
 *
 * 六套外观，各自有浅/深两套颜色序列与循环周期：
 *   classic  4s / 7 色    neon    3s / 3 色    terminal 6s / 2 色（反向）
 *   candy    5s / 3 色    glitch  2s / 2 色（反向）   original（固定色）
 */
export interface StatusAppearanceOption {
  id: string;
  label: string;
}

export class StatusAppearance {
  static readonly KEY: string = 'statusAppearance';
  static readonly DEFAULT_ID: string = 'classic';

  static choices(): StatusAppearanceOption[] {
    return [
      { id: 'classic', label: '经典流光' },
      { id: 'neon', label: '霓虹' },
      { id: 'terminal', label: '终端' },
      { id: 'candy', label: '糖果' },
      { id: 'glitch', label: '故障' },
      { id: 'original', label: '简约' }
    ];
  }

  static normalize(id: string): string {
    for (const option of StatusAppearance.choices()) {
      if (option.id === id) {
        return id;
      }
    }
    return StatusAppearance.DEFAULT_ID;
  }

  static label(id: string): string {
    const normalized: string = StatusAppearance.normalize(id);
    for (const option of StatusAppearance.choices()) {
      if (option.id === normalized) {
        return option.label;
      }
    }
    return '经典流光';
  }

  /** 循环周期（毫秒）。 */
  static durationMs(id: string): number {
    const normalized: string = StatusAppearance.normalize(id);
    if (normalized === 'neon') {
      return 3000;
    }
    if (normalized === 'terminal') {
      return 6000;
    }
    if (normalized === 'candy') {
      return 5000;
    }
    if (normalized === 'glitch') {
      return 2000;
    }
    if (normalized === 'original') {
      return 2200;
    }
    return 4000;
  }

  /** 色板：按 appearance + 主题返回颜色序列（#RRGGBB）。 */
  static colors(id: string, isDark: boolean): string[] {
    const normalized: string = StatusAppearance.normalize(id);
    if (normalized === 'neon') {
      return isDark
        ? ['#22D3EE', '#A78BFA', '#F472B6']
        : ['#0E7490', '#7C3AED', '#BE185D'];
    }
    if (normalized === 'terminal') {
      return isDark ? ['#4ADE80', '#86EFAC'] : ['#15803D', '#166534'];
    }
    if (normalized === 'candy') {
      return isDark
        ? ['#FB7185', '#FBBF24', '#F472B6']
        : ['#BE123C', '#B45309', '#BE185D'];
    }
    if (normalized === 'glitch') {
      return isDark ? ['#FF5F6D', '#5FD4FF'] : ['#D92B4B', '#0E7490'];
    }
    if (normalized === 'original') {
      // DSH 客户端默认配色（label-deep-diving / shimmer）
      return isDark ? ['#7D9ADE', '#8ABBFE'] : ['#345DBA', '#243D80'];
    }
    return isDark
      ? ['#FF5F6D', '#FFC371', '#FFDD55', '#7DFF7D', '#5FD4FF', '#A78BFA', '#FF8ADB']
      : ['#D92B4B', '#C2410C', '#A16207', '#15803D', '#0E7490', '#6D28D9', '#BE185D'];
  }

  /** 按时间采样当前颜色（线性插值，对齐小程序 sampleColor）。 */
  static sample(id: string, isDark: boolean, elapsedMs: number): string {
    const palette: string[] = StatusAppearance.colors(id, isDark);
    if (palette.length === 0) {
      return '#A8BEDB';
    }
    if (palette.length === 1) {
      return palette[0];
    }
    const duration: number = StatusAppearance.durationMs(id);
    const total: number = duration > 0 ? duration : 4000;
    const ratio: number = (elapsedMs % total) / total;
    const scaled: number = ratio * palette.length;
    const index: number = Math.floor(scaled) % palette.length;
    const next: number = (index + 1) % palette.length;
    const t: number = scaled - Math.floor(scaled);
    return StatusAppearance.mix(palette[index], palette[next], t);
  }

  private static mix(from: string, to: string, t: number): string {
    const r1: number = parseInt(from.substring(1, 3), 16);
    const g1: number = parseInt(from.substring(3, 5), 16);
    const b1: number = parseInt(from.substring(5, 7), 16);
    const r2: number = parseInt(to.substring(1, 3), 16);
    const g2: number = parseInt(to.substring(3, 5), 16);
    const b2: number = parseInt(to.substring(5, 7), 16);
    const r: number = Math.round(r1 + (r2 - r1) * t);
    const g: number = Math.round(g1 + (g2 - g1) * t);
    const b: number = Math.round(b1 + (b2 - b1) * t);
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
  }
}
