/**
 * 字号大小二级页（对齐小程序 pages/settings 的字体与字号弹窗内容）。
 *
 * 原来「字号大小」是页内底部弹层；现在改为导航二级页，排版参考小程序：
 *   卡片一：字号大小（四档 chip + 预览）
 *   卡片二：字体与字号明细（正文字体 / 代码字体 / 代码字号 / 终端字体 / 终端字号）
 *   卡片三：字体预览面板
 *
 * 数据流：与设置页共用 PreferencesStore 键，改动即时落盘 + 写 AppStorage，
 * 返回设置页时由 onShown 的 refreshPrefs() 刷新展示值。
 */

import { NavBackButton } from '../components/NavBackButton';
import { PreferencesStore } from 'nativecore';

/** 字号档位与其对应的正文 px（与设置页预览一致） */
interface SizeOption {
  label: string;
  px: number;
}

const SIZE_OPTIONS: SizeOption[] = [
  { label: '小', px: 14 },
  { label: '标准', px: 16 },
  { label: '大', px: 18 },
  { label: '特大', px: 20 }
];

@Component
export struct FontSizePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;

  @State fontSize: string = '标准';
  @State textFont: string = '';
  @State codeFont: string = '';
  @State terminalFont: string = '';
  @State codeSize: string = '';
  @State terminalSize: string = '';

  private topInset(): number {
    return this.safeTopStorage > 0 ? this.safeTopStorage : 38.9;
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#10131A';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.52)';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.08)' : 'rgba(16,19,24,0.06)';
  }

  private innerFill(): string {
    return this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)';
  }

  private chipBg(selected: boolean): string {
    if (selected) {
      return this.isDark ? 'rgba(76,108,224,0.24)' : 'rgba(76,108,224,0.12)';
    }
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)';
  }

  private chipBorder(selected: boolean): string {
    return selected ? 'rgba(76,108,224,0.55)' : this.dividerColor();
  }

  /** 正文预览字号：按当前档位取 px */
  private previewSize(): number {
    for (const option of SIZE_OPTIONS) {
      if (option.label === this.fontSize) {
        return option.px;
      }
    }
    return 16;
  }

  private codePreviewSize(): number {
    const parsed: number = Number(this.codeSize);
    return isFinite(parsed) && parsed > 0 ? parsed : 13;
  }

  aboutToAppear(): void {
    const prefs: PreferencesStore = PreferencesStore.get();
    this.fontSize = prefs.getString('contentFontSize', '标准');
    this.textFont = prefs.getString('fontFamilyText', '');
    this.codeFont = prefs.getString('fontFamilyCode', '');
    this.terminalFont = prefs.getString('fontFamilyTerminal', '');
    this.codeSize = prefs.getString('codeFontSize', '');
    this.terminalSize = prefs.getString('terminalFontSize', '');
  }

  private applyFontSize(value: string): void {
    this.fontSize = value;
    PreferencesStore.get().putString('contentFontSize', value);
    AppStorage.setOrCreate<string>('contentFontSize', value);
    // 立即同步给设置页并自动返回上一级
    AppStorage.setOrCreate<string>('prefPickerChoice', 'fontsize\u0001' + value);
    const revision: number = AppStorage.get<number>('prefPickerRevision') ?? 0;
    AppStorage.setOrCreate<number>('prefPickerRevision', revision + 1);
    this.pageStack.pop();
  }

  private commitFamily(role: string, value: string): void {
    if (role === 'text') {
      this.textFont = value;
      PreferencesStore.get().putString('fontFamilyText', value);
    } else if (role === 'code') {
      this.codeFont = value;
      PreferencesStore.get().putString('fontFamilyCode', value);
    } else {
      this.terminalFont = value;
      PreferencesStore.get().putString('fontFamilyTerminal', value);
    }
  }

  private commitSize(role: string, value: string): void {
    if (role === 'code') {
      this.codeSize = value;
      PreferencesStore.get().putString('codeFontSize', value);
    } else {
      this.terminalSize = value;
      PreferencesStore.get().putString('terminalFontSize', value);
    }
  }

  // ── 行 / 分组 ──

  @Builder
  groupTitle(title: string) {
    Text(title)
      .fontSize(13)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 16, right: 16, top: 18, bottom: 7 })
  }

  @Builder
  divider() {
    Divider()
      .color(this.dividerColor())
      .strokeWidth(0.5)
      .margin({ left: 16, right: 16 })
  }

  /** 字体族输入行：标题 + 说明 + 右侧输入框（对齐小程序 font-detail-row） */
  @Builder
  familyRow(label: string, hint: string, value: string, role: string) {
    Column({ space: 6 }) {
      Row() {
        Column({ space: 3 }) {
          Text(label).fontSize(16).fontColor(this.textColor())
          Text(hint).fontSize(12).fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        TextInput({ text: value, placeholder: '默认' })
          .caretStyle({ width: 1 })
          .width(132)
          .height(34)
          .fontSize(13)
          .fontColor(this.textColor())
          .placeholderColor(this.subColor())
          .backgroundColor(this.innerFill())
          .borderRadius(9)
          .onChange((v: string) => {
            this.commitFamily(role, v);
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
  }

  /** 字号数字行：标题 + 说明 + 右侧数字输入 + px */
  @Builder
  sizeRow(label: string, hint: string, value: string, role: string) {
    Row() {
      Column({ space: 3 }) {
        Text(label).fontSize(16).fontColor(this.textColor())
        Text(hint).fontSize(12).fontColor(this.subColor())
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Row({ space: 4 }) {
        TextInput({ text: value, placeholder: '默认' })
          .caretStyle({ width: 1 })
          .type(InputType.Number)
          .width(56)
          .height(34)
          .textAlign(TextAlign.Center)
          .fontSize(14)
          .fontColor(this.textColor())
          .placeholderColor(this.subColor())
          .backgroundColor(this.flatTransparent())
          .borderRadius(8)
          .onChange((v: string) => {
            this.commitSize(role, v);
          })
        Text('px').fontSize(13).fontColor(this.subColor())
      }
      .padding({ left: 8, right: 8 })
      .height(36)
      .borderRadius(9)
      .backgroundColor(this.innerFill())
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
  }

  private flatTransparent(): string {
    return '#00000000';
  }

  @Builder
  sizeChip(option: SizeOption) {
    Text(option.label)
      .fontSize(14)
      .fontWeight(this.fontSize === option.label ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(this.fontSize === option.label ? '#2E6BE6' : this.textColor())
      .textAlign(TextAlign.Center)
      .height(36)
      .layoutWeight(1)
      .borderRadius(10)
      .backgroundColor(this.chipBg(this.fontSize === option.label))
      .border({ width: 1, color: this.chipBorder(this.fontSize === option.label) })
      .onClick(() => {
        this.applyFontSize(option.label);
      })
  }

  build() {
    NavDestination() {
      Column() {
        // 导航：返回 + 居中标题（与设置页其他二级页一致）
        Row() {
          NavBackButton({ isDark: this.isDark })
            .onClick(() => {
              this.pageStack.pop();
            })

          Text('字号大小')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .textAlign(TextAlign.Center)

          Row().width(44).height(44)
        }
        .width('100%')
        .height(56)
        .padding({ left: 16, right: 16 })
        .margin({ top: this.topInset() })

        Scroll() {
          Column() {
            // ── 字号档位 ──
            this.groupTitle('字号大小')

            Column() {
              Row() {
                Column({ space: 3 }) {
                  Text('字号大小').fontSize(16).fontColor(this.textColor())
                  Text('仅影响会话内容的字号').fontSize(12).fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                Text(this.fontSize)
                  .fontSize(14)
                  .fontColor(this.subColor())
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)
              .padding({ left: 16, right: 16, top: 14, bottom: 12 })

              Row({ space: 8 }) {
                ForEach(SIZE_OPTIONS, (option: SizeOption) => {
                  this.sizeChip(option)
                }, (option: SizeOption) => option.label)
              }
              .width('100%')
              .padding({ left: 16, right: 16, bottom: 14 })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(14)
            .clip(true)

            // ── 字体与字号明细 ──
            this.groupTitle('字体与字号')

            Column() {
              this.familyRow('正文字体', '用于界面与会话正文', this.textFont, 'text')
              this.divider()
              this.familyRow('代码字体', '用于代码块、行内代码与工具输出', this.codeFont, 'code')
              this.divider()
              this.sizeRow('代码字号', '代码块与工具输出字号', this.codeSize, 'code')
              this.divider()
              this.familyRow('终端字体', '用于侧栏终端', this.terminalFont, 'terminal')
              this.divider()
              this.sizeRow('终端字号', '侧栏终端字号', this.terminalSize, 'terminal')
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(14)
            .clip(true)

            Text('多个字体用逗号分隔，留空使用默认字体。')
              .fontSize(12)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 20, right: 20, top: 8 })

            // ── 字体预览 ──
            this.groupTitle('字体预览')

            Column({ space: 8 }) {
              Text('正文示例 Aa 你好，这是一段会话正文预览。')
                .fontSize(this.previewSize())
                .fontColor(this.textColor())
                .width('100%')
              Text('const answer = 42;  // 代码预览')
                .fontSize(this.codePreviewSize())
                .fontFamily('monospace')
                .fontColor(this.subColor())
                .width('100%')
              Text('$ dsh --version')
                .fontSize(this.codePreviewSize())
                .fontFamily('monospace')
                .fontColor(this.subColor())
                .width('100%')
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding(16)
            .backgroundColor(this.cardBg())
            .borderRadius(14)

            Text('实际可用字体取决于设备；找不到的字体将使用后备字体。偏好保存在当前 App，自动生效。')
              .fontSize(12)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 20, right: 20, top: 12, bottom: 30 })
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
