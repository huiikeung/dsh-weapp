/**
 * DSH 主题系统
 * 对照 iOS 端 DeepSeekHarnessMobile/Core/Theme.swift 的 DSHColor / 语义样式，
 * 色值 1:1 对齐（0-1 浮点 → 8 位 ARGB 十六进制）。
 */

export class DSHColor {
  /** navy      Color(red: 0.025, green: 0.09,  blue: 0.17)  */
  static readonly navy: string = '#06172C';
  /** navyRaised Color(red: 0.05,  green: 0.14,  blue: 0.25)  */
  static readonly navyRaised: string = '#0D2440';
  /** ocean     Color(red: 0.18,  green: 0.42,  blue: 0.9)   */
  static readonly ocean: string = '#2E6BE6';
  /** mist      Color(red: 0.75,  green: 0.84,  blue: 1)     */
  static readonly mist: string = '#BFD6FF';
  /** ink       Color(red: 0.055, green: 0.075, blue: 0.1)   */
  static readonly ink: string = '#0E131A';
  /** paper     Color(red: 0.975, green: 0.98,  blue: 0.99)  */
  static readonly paper: string = '#F8FAFC';
  /** purple    Color(red: 0.48,  green: 0.33,  blue: 0.78)  */
  static readonly purple: string = '#7A54C7';
  /** orange    Color(red: 0.94,  green: 0.49,  blue: 0.08)  */
  static readonly orange: string = '#F07D14';
  /** amber     Color(red: 1.0,   green: 0.68,  blue: 0.12)  */
  static readonly amber: string = '#FFAE1F';
  /** success   Color(red: 0.18,  green: 0.72,  blue: 0.36)  */
  static readonly success: string = '#2EB85C';
}

/** 语义样式 token，对齐 iOS Theme 中的常用排版/圆角/间距 */
export class DSHTheme {
  static readonly bg: string = DSHColor.navy;
  static readonly bgRaised: string = DSHColor.navyRaised;
  static readonly textPrimary: string = DSHColor.paper;
  static readonly textSecondary: string = DSHColor.mist;
  static readonly accent: string = DSHColor.ocean;

  static readonly radiusL: number = 20;
  static readonly radiusM: number = 14;
  static readonly radiusS: number = 10;

  static readonly padL: number = 20;
  static readonly padM: number = 14;
  static readonly padS: number = 8;

  static readonly fontTitle: number = 22;
  static readonly fontBody: number = 16;
  static readonly fontCaption: number = 13;

  /** 消息气泡（用户/助手）背景 */
  static readonly bubbleUser: string = DSHColor.ocean;
  static readonly bubbleAssistant: string = DSHColor.navyRaised;
}
