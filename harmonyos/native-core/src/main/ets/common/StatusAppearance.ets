/**
 * 运行状态外观（对齐小程序 styles/status-tail-animation.wxss 生成的色板）。
 *
 * 六套外观，各自有浅/深两套颜色序列与循环周期：
 *   classic  4s / 7 色    neon    3s / 3 色    terminal 6s / 2 色（反向）
 *   candy    5s / 3 色    glitch  2s / 2 色（反向）   original（固定色）
 */
export interface StatusKeyframe {
  at: number;
  color: string;
}

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

  /**
   * 鲸尾配色关键帧（逐字对齐小程序 status-tail-animation.wxss 的 @keyframes）：
   * 每个样式有自己的停靠点，注意「简约」是非对称的（66.7% 后停在首色）。
   */
  static keyframes(id: string, isDark: boolean): StatusKeyframe[] {
    const normalized: string = StatusAppearance.normalize(id);
    if (normalized === 'neon') {
      return isDark
        ? [
          { at: 0, color: '#22D3EE' }, { at: 33.3333, color: '#A78BFA' },
          { at: 66.6667, color: '#F472B6' }, { at: 100, color: '#22D3EE' }
        ]
        : [
          { at: 0, color: '#0E7490' }, { at: 33.3333, color: '#7C3AED' },
          { at: 66.6667, color: '#BE185D' }, { at: 100, color: '#0E7490' }
        ];
    }
    if (normalized === 'terminal') {
      return isDark
        ? [{ at: 0, color: '#4ADE80' }, { at: 50, color: '#86EFAC' }, { at: 100, color: '#4ADE80' }]
        : [{ at: 0, color: '#15803D' }, { at: 50, color: '#166534' }, { at: 100, color: '#15803D' }];
    }
    if (normalized === 'candy') {
      return isDark
        ? [
          { at: 0, color: '#FB7185' }, { at: 33.3333, color: '#FBBF24' },
          { at: 66.6667, color: '#F472B6' }, { at: 100, color: '#FB7185' }
        ]
        : [
          { at: 0, color: '#BE123C' }, { at: 33.3333, color: '#B45309' },
          { at: 66.6667, color: '#BE185D' }, { at: 100, color: '#BE123C' }
        ];
    }
    if (normalized === 'glitch') {
      return isDark
        ? [{ at: 0, color: '#FF5F6D' }, { at: 50, color: '#5FD4FF' }, { at: 100, color: '#FF5F6D' }]
        : [{ at: 0, color: '#D92B4B' }, { at: 50, color: '#0E7490' }, { at: 100, color: '#D92B4B' }];
    }
    if (normalized === 'original') {
      // 非对称：0 → 33.3% 变暗，66.7% 回亮，之后停在首色
      return isDark
        ? [
          { at: 0, color: '#7D9ADE' }, { at: 33.3333, color: '#8ABBFE' },
          { at: 66.6667, color: '#7D9ADE' }, { at: 100, color: '#7D9ADE' }
        ]
        : [
          { at: 0, color: '#345DBA' }, { at: 33.3333, color: '#243D80' },
          { at: 66.6667, color: '#345DBA' }, { at: 100, color: '#345DBA' }
        ];
    }
    // classic：7 色等分（每段 14.2857%）
    return isDark
      ? [
        { at: 0, color: '#FF5F6D' }, { at: 14.2857, color: '#FFC371' },
        { at: 28.5714, color: '#FFDD55' }, { at: 42.8571, color: '#7DFF7D' },
        { at: 57.1429, color: '#5FD4FF' }, { at: 71.4286, color: '#A78BFA' },
        { at: 85.7143, color: '#FF8ADB' }, { at: 100, color: '#FF5F6D' }
      ]
      : [
        { at: 0, color: '#D92B4B' }, { at: 14.2857, color: '#C2410C' },
        { at: 28.5714, color: '#A16207' }, { at: 42.8571, color: '#15803D' },
        { at: 57.1429, color: '#0E7490' }, { at: 71.4286, color: '#6D28D9' },
        { at: 85.7143, color: '#BE185D' }, { at: 100, color: '#D92B4B' }
      ];
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
      return isDark ? ['#7D9ADE', '#8ABBFE', '#7D9ADE'] : ['#345DBA', '#243D80', '#345DBA'];
    }
    return isDark
      ? ['#FF5F6D', '#FFC371', '#FFDD55', '#7DFF7D', '#5FD4FF', '#A78BFA', '#FF8ADB']
      : ['#D92B4B', '#C2410C', '#A16207', '#15803D', '#0E7490', '#6D28D9', '#BE185D'];
  }

  /** 正向相位（0..1，不反向）上采样关键帧颜色：文字与鲸尾共用同一条曲线。 */
  static sampleAtPhase(id: string, isDark: boolean, phase: number): string {
    const frames: StatusKeyframe[] = StatusAppearance.keyframes(id, isDark);
    if (frames.length === 0) {
      return '#A8BEDB';
    }
    let p: number = phase % 1;
    if (p < 0) {
      p = p + 1;
    }
    const pct: number = p * 100;
    for (let i = 0; i < frames.length - 1; i++) {
      const from: StatusKeyframe = frames[i];
      const to: StatusKeyframe = frames[i + 1];
      if (pct >= from.at && pct <= to.at) {
        const span: number = to.at - from.at;
        const t: number = span > 0 ? (pct - from.at) / span : 0;
        return StatusAppearance.mix(from.color, to.color, t);
      }
    }
    return frames[frames.length - 1].color;
  }

  /** 按时间采样鲸尾颜色：先算相位，terminal/glitch 反向播放。 */
  static sample(id: string, isDark: boolean, elapsedMs: number): string {
    const duration: number = StatusAppearance.durationMs(id);
    const total: number = duration > 0 ? duration : 4000;
    let ratio: number = (elapsedMs % total) / total;
    if (ratio < 0) {
      ratio = ratio + 1;
    }
    if (id === 'terminal' || id === 'glitch') {
      ratio = 1 - ratio;
    }
    return StatusAppearance.sampleAtPhase(id, isDark, ratio);
  }

  /**
   * 把 #RRGGBB 转成 4x5 颜色矩阵，用于 Image.colorFilter：
   * 不透明像素统一映射成该颜色（保留 alpha），保证图标显示色 === 采样色。
   */
  static filterMatrix(color: string): number[] {
    const hex: string = color.length === 7 ? color : '#A8BEDB';
    const r: number = parseInt(hex.substring(1, 3), 16) / 255;
    const g: number = parseInt(hex.substring(3, 5), 16) / 255;
    const b: number = parseInt(hex.substring(5, 7), 16) / 255;
    return [
      0, 0, 0, 0, r,
      0, 0, 0, 0, g,
      0, 0, 0, 0, b,
      0, 0, 0, 1, 0
    ];
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
