/**
 * Bot 模式首页背景的配色预设（用户可在「设置 → Bot 背景」里自己切换）。
 * 结构 = 基色 + 两段流体丝带色 + 网格墨色 + 鲸鱼点色 + 底部收敛 + 游移柔光，
 * 深浅色各一套；切换只影响 Bot 模式背景，工作模式深海背景不受影响。
 */
export interface BotPalette {
  id: string;
  name: string;
  hint: string;
  /** 设置页里那一小条预览色 */
  preview: string;
  base: string;
  baseDark: string;
  fluidFrom: number[];
  fluidTo: number[];
  fluidFromDark: number[];
  fluidToDark: number[];
  gridInk: string;
  gridInkDark: string;
  gridDot: string;
  gridDotDark: string;
  whale: string;
  whaleDark: string;
  veil: string;
  veilDark: string;
  accent: string;
  accentDark: string;
  /** 主按钮/强调按钮填充（我的 Bot、新建 Bot 等页面用它对齐主题） */
  action: string;
  actionDark: string;
}

export const BOT_PALETTES: BotPalette[] = [
  {
    id: 'periwinkle',
    action: '#5B6ECB',
    actionDark: '#9FB0F2',
    name: '长春花',
    hint: '冷蓝紫，默认',
    preview: '#B9C4F0',
    base: '#EEF1FB',
    baseDark: '#14151F',
    fluidFrom: [0.725, 0.769, 0.941],
    fluidTo: [0.973, 0.976, 1.000],
    fluidFromDark: [0.157, 0.161, 0.227],
    fluidToDark: [0.290, 0.298, 0.400],
    gridInk: 'rgba(88,104,168,0.055)',
    gridInkDark: 'rgba(0,0,0,0.16)',
    gridDot: 'rgba(88,104,168,0.11)',
    gridDotDark: 'rgba(0,0,0,0.20)',
    whale: 'rgba(104,124,190,',
    whaleDark: 'rgba(184,198,240,',
    veil: 'rgba(238,241,251,',
    veilDark: 'rgba(20,21,31,',
    accent: 'rgba(255,255,255,',
    accentDark: 'rgba(140,160,226,'
  },
  {
    id: 'mint',
    action: '#3E8E82',
    actionDark: '#8FD9CD',
    name: '薄荷青',
    hint: '最清新',
    preview: '#A9DCD6',
    base: '#E9F5F3',
    baseDark: '#101A19',
    fluidFrom: [0.663, 0.863, 0.839],
    fluidTo: [0.957, 0.992, 0.984],
    fluidFromDark: [0.106, 0.176, 0.169],
    fluidToDark: [0.243, 0.345, 0.333],
    gridInk: 'rgba(64,140,130,0.055)',
    gridInkDark: 'rgba(0,0,0,0.16)',
    gridDot: 'rgba(64,140,130,0.11)',
    gridDotDark: 'rgba(0,0,0,0.20)',
    whale: 'rgba(72,150,140,',
    whaleDark: 'rgba(170,226,216,',
    veil: 'rgba(233,245,243,',
    veilDark: 'rgba(16,26,25,',
    accent: 'rgba(255,255,255,',
    accentDark: 'rgba(120,200,188,'
  },
  {
    id: 'sky',
    action: '#4A7BC0',
    actionDark: '#9AC0F0',
    name: '天空蓝',
    hint: '中性偏冷',
    preview: '#A9C8F0',
    base: '#EAF2FB',
    baseDark: '#101823',
    fluidFrom: [0.663, 0.784, 0.941],
    fluidTo: [0.961, 0.980, 1.000],
    fluidFromDark: [0.106, 0.149, 0.216],
    fluidToDark: [0.243, 0.318, 0.412],
    gridInk: 'rgba(84,124,178,0.055)',
    gridInkDark: 'rgba(0,0,0,0.16)',
    gridDot: 'rgba(84,124,178,0.11)',
    gridDotDark: 'rgba(0,0,0,0.20)',
    whale: 'rgba(84,132,190,',
    whaleDark: 'rgba(172,206,244,',
    veil: 'rgba(234,242,251,',
    veilDark: 'rgba(16,24,35,',
    accent: 'rgba(255,255,255,',
    accentDark: 'rgba(126,170,226,'
  },
  {
    id: 'ice',
    action: '#6A6ACB',
    actionDark: '#B3B4F2',
    name: '冰紫',
    hint: '接近原来的淡紫',
    preview: '#C3C6F2',
    base: '#F0F0FC',
    baseDark: '#15141F',
    fluidFrom: [0.765, 0.776, 0.949],
    fluidTo: [0.980, 0.980, 1.000],
    fluidFromDark: [0.165, 0.157, 0.227],
    fluidToDark: [0.302, 0.290, 0.400],
    gridInk: 'rgba(105,108,170,0.055)',
    gridInkDark: 'rgba(0,0,0,0.16)',
    gridDot: 'rgba(105,108,170,0.11)',
    gridDotDark: 'rgba(0,0,0,0.20)',
    whale: 'rgba(118,122,190,',
    whaleDark: 'rgba(192,196,244,',
    veil: 'rgba(240,240,252,',
    veilDark: 'rgba(21,20,31,',
    accent: 'rgba(255,255,255,',
    accentDark: 'rgba(150,152,226,'
  },
  {
    id: 'lavender',
    action: '#6C50A7',
    actionDark: '#C8B5E8',
    name: '淡紫',
    hint: 'iOS 原版，略微偏粉',
    preview: '#C9B3E3',
    base: '#F4F1FA',
    baseDark: '#17161F',
    fluidFrom: [0.788, 0.702, 0.890],
    fluidTo: [0.988, 0.973, 1.000],
    fluidFromDark: [0.200, 0.169, 0.243],
    fluidToDark: [0.341, 0.298, 0.373],
    gridInk: 'rgba(110,82,158,0.055)',
    gridInkDark: 'rgba(0,0,0,0.16)',
    gridDot: 'rgba(110,82,158,0.11)',
    gridDotDark: 'rgba(0,0,0,0.20)',
    whale: 'rgba(133,113,176,',
    whaleDark: 'rgba(200,181,232,',
    veil: 'rgba(244,241,250,',
    veilDark: 'rgba(23,22,31,',
    accent: 'rgba(255,255,255,',
    accentDark: 'rgba(146,120,196,'
  }
];

export const BOT_BG_DEFAULT: string = 'periwinkle';

export function botPalette(id: string | undefined): BotPalette {
  const wanted: string = id === undefined ? BOT_BG_DEFAULT : id;
  for (let i = 0; i < BOT_PALETTES.length; i++) {
    if (BOT_PALETTES[i].id === wanted) {
      return BOT_PALETTES[i];
    }
  }
  return BOT_PALETTES[0];
}
