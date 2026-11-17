/**
 * 设置项二级页（对齐小程序 settings 二级页形态）。
 *
 * 原来这些选项是页内弹层；现在统一改成导航二级页：
 *   外观 / 执行图标 / 语言 / 工作步骤展示 / 工作步骤收起时机 /
 *   震动反馈 / 玻璃样式 / 原生样式 / 卡片样式
 *
 * 数据流：设置页 push 前写入 prefPickerKind / prefPickerValue；
 * 本页点击后写入 prefPickerChoice（kind + SEP + id）并返回，
 * 由设置页的 @Watch 回调复用既有 applyOptionChoice 逻辑（含偏好持久化与主题应用）。
 */

import { ProcLoaderView } from '../components/ProcLoaderView';

interface PickerOption {
  id: string;
  label: string;
  detail: string;
}

const SEP: string = '\u0001';

function optionsFor(kind: string): PickerOption[] {
  const out: PickerOption[] = [];
  const push = (id: string, label: string, detail: string): void => {
    out.push({ id: id, label: label, detail: detail });
  };
  if (kind === 'appearance') {
    push('auto', '跟随微信', '与微信客户端的深浅色保持一致');
    push('light', '浅色', '始终使用浅色界面');
    push('dark', '深色', '始终使用深色界面');
  } else if (kind === 'procion') {
    push('spin-ring', '旋转圆环', '经典转圈，最克制');
    push('cells', '格子', '四格依次点亮');
    push('terra', '思考球', '三点呼吸');
    push('morph', '变形方', '方框随相位变形');
    push('grid', '点阵', '3×3 点阵流动');
    push('orbit', '轨道', '单点绕圈');
    push('ripple', '波纹', '圆环扩散');
    push('wave', '声波', '竖条起伏');
    push('pulse-ring', '脉冲环', '圆环脉冲');
    push('breathe-bars', '呼吸条', '竖条呼吸');
    push('spin-square', '旋方', '方框旋转');
    push('typing-dots', '打字点', '三点跳动');
    push('scan-line', '扫描线', '横线扫描');
  } else if (kind === 'language') {
    push('system', '跟随系统', '');
    push('zh', '简体中文', '');
    push('en', 'English', '');
  } else if (kind === 'mode') {
    push('compact', '简洁', '只显示最终结果');
    push('standard', '标准', '显示主要步骤');
    push('detailed', '详细', '显示每个工具调用');
    push('verbose', '完全展开', '显示所有细节');
  } else if (kind === 'timing') {
    push('completion', '回答结束后', '整轮回答结束就收起过程');
    push('next-input', '下次有新消息时', '保留过程直到你发下一条');
  } else if (kind === 'haptics') {
    push('off', '关闭', '');
    push('light', '轻', '');
    push('medium', '中', '');
    push('heavy', '重', '');
  } else if (kind === 'glass') {
    push('glass-default', '默认', '与切换主机同款材质');
    push('glass-clear', '通透', '更透的背景');
    push('glass-frosted', '磨砂', '更强的模糊');
    push('glass-dark', '深色', '深色玻璃');
  } else if (kind === 'native') {
    push('default', '默认', '');
    push('dim', '暗淡', '');
    push('darker', '更暗', '');
    push('bright', '明亮', '');
    push('brightest', '最亮', '');
  } else if (kind === 'card') {
    push('float', '浮起', '卡片带阴影');
    push('plain', '朴素', '无阴影描边');
    push('compact', '紧凑', '更小的间距');
  }
  return out;
}

function titleFor(kind: string): string {
  if (kind === 'appearance') {
    return '外观';
  }
  if (kind === 'procion') {
    return '执行图标';
  }
  if (kind === 'language') {
    return '语言';
  }
  if (kind === 'mode') {
    return '工作步骤展示';
  }
  if (kind === 'timing') {
    return '工作步骤收起时机';
  }
  if (kind === 'haptics') {
    return '震动反馈';
  }
  if (kind === 'glass') {
    return '玻璃样式';
  }
  if (kind === 'native') {
    return '原生样式';
  }
  if (kind === 'card') {
    return '卡片样式';
  }
  return '设置';
}

function subtitleFor(kind: string): string {
  if (kind === 'appearance') {
    return '选择界面深浅色';
  }
  if (kind === 'procion') {
    return '选择执行图标动效';
  }
  if (kind === 'language') {
    return '选择界面语言';
  }
  if (kind === 'mode') {
    return '选择希望看到多少工具调用细节';
  }
  if (kind === 'timing') {
    return '过程块收起的时间点';
  }
  if (kind === 'haptics') {
    return '操作反馈的震动强度';
  }
  if (kind === 'glass') {
    return '毛玻璃材质的透明度';
  }
  if (kind === 'native') {
    return '原生控件的亮度层级';
  }
  if (kind === 'card') {
    return '卡片的外观形态';
  }
  return '';
}

@Component
export struct PreferencePickerPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('prefPickerKind') kind: string = '';
  @StorageLink('prefPickerValue') currentValue: string = '';

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

  private choose(option: PickerOption): void {
    // 交给设置页处理：写入偏好 + 应用主题等既有逻辑
    AppStorage.setOrCreate<string>('prefPickerChoice', this.kind + SEP + option.id);
    this.pageStack.pop();
  }

  build() {
    NavDestination() {
      Column() {
        // 顶栏：返回 + 标题（对齐小程序二级页头部层级）
        Row({ space: 4 }) {
          Text('‹')
            .fontSize(28)
            .fontColor(this.textColor())
            .width(44)
            .height(44)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.pageStack.pop();
            })
          Blank()
        }
        .width('100%')
        .height(52)
        .padding({ left: 4, right: 16 })

        Scroll() {
          Column() {
            // .status-style-head：标题 + 说明（小程序 status-style-hint）
            Column({ space: 6 }) {
              Text(titleFor(this.kind))
                .fontSize(20) // 34rpx ≈ 20vp
                .fontWeight(FontWeight.Bold)
                .fontColor(this.textColor())
                .width('100%')
              if (subtitleFor(this.kind).length > 0) {
                Text(subtitleFor(this.kind))
                  .fontSize(14) // 24rpx
                  .fontColor(this.subColor())
                  .width('100%')
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding({ bottom: 14 })

            // 选项卡片：每张 = 标题行 + 动效预览 + 描述（对齐 .status-style-option）
            ForEach(optionsFor(this.kind), (option: PickerOption) => {
              Column({ space: 0 }) {
                Row() {
                  Text(option.label)
                    .fontSize(16.4) // 28rpx
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Blank()
                  Text(option.id === this.currentValue ? '已选择' : '')
                    .fontSize(12.9) // 22rpx
                    .fontColor('#5676C8')
                }
                .width('100%')

                // 预览行：动效 + 「正在执行命令」
                Row({ space: 10 }) {
                  ProcLoaderView({ style: option.id, isDark: this.isDark, boxSize: 18.77 })
                  Text('正在执行命令')
                    .fontSize(14)
                    .fontColor(this.textColor())
                }
                .width('100%')
                .margin({ top: 13, bottom: 8 })
                .alignItems(VerticalAlign.Center)

                if (option.detail.length > 0) {
                  Text(option.detail)
                    .fontSize(12.9)
                    .lineHeight(20.6)
                    .fontColor(this.subColor())
                    .width('100%')
                }
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding(14)
              .margin({ bottom: 9.4 })
              .borderRadius(14)
              .border({
                width: 1,
                color: option.id === this.currentValue ? '#6B87D7' : this.dividerColor()
              })
              .backgroundColor(option.id === this.currentValue
                ? 'rgba(83,112,198,0.06)'
                : (this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.03)'))
              .onClick(() => {
                this.choose(option);
              })
            }, (option: PickerOption) => this.kind + '-' + option.id)

            Text('动效保存在当前 App · 自动保存')
              .fontSize(12.9)
              .fontColor(this.subColor())
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding({ top: 9, bottom: 24 })
          }
          .width('100%')
          .padding({ left: 18.7, right: 18.7 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
      }
      .width('100%')
      .height('100%')
      .padding({ top: this.topInset() })
      .backgroundColor(this.pageBg())
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
