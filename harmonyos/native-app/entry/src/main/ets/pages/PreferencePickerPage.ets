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

import { Logger, PreferencesStore, WorkStepPresentation } from 'nativecore';
import { ProcLoaderView } from '../components/ProcLoaderView';
import { Haptics } from '../services/Haptics';
import { NavBackButton } from '../components/NavBackButton';

interface PickerOption {
  id: string;
  label: string;
  detail: string;
  /** 会话设置-Agent 预设：损坏预设置灰不可选 */
  disabled?: boolean;
}

const SEP: string = '\u0001';

function optionsFor(kind: string): PickerOption[] {
  const out: PickerOption[] = [];
  const push = (id: string, label: string, detail: string): void => {
    out.push({ id: id, label: label, detail: detail });
  };
  if (kind === 'session-agent-preset') {
    // 动态选项：会话设置页打开前把网关下发的预设写进 AppStorage（JSON）
    const raw: string = AppStorage.get<string>('sessionPresetPickerJson') ?? '';
    if (raw.length > 0) {
      try {
        const parsed: Object = JSON.parse(raw) as Object;
        if (Array.isArray(parsed)) {
          for (const one of parsed as Object[]) {
            const rec = one as Record<string, Object>;
            const id: string = rec['id'] === undefined ? '' : String(rec['id']);
            const label: string = rec['label'] === undefined ? '' : String(rec['label']);
            const detail: string = rec['detail'] === undefined ? '' : String(rec['detail']);
            const disabled: boolean = rec['disabled'] === undefined ? false : (rec['disabled'] as boolean);
            out.push({ id: id, label: label, detail: detail, disabled: disabled });
          }
        }
      } catch (err) {
        // 解析失败不阻断（列表为空时由打开方兜底）
      }
    }
    return out;
  }
  if (kind === 'appearance') {
    push('auto', '跟随系统', '与系统深浅色保持一致');
    push('light', '浅色', '始终使用浅色界面');
    push('dark', '深色', '始终使用深色界面');
  } else if (kind === 'procion') {
    // 默认置顶（系统加载图）；其余名称与说明逐条对齐小程序 proc-icon-style.js，「格子」已下线
    push('default', '默认', '系统加载图 · 跟随系统');
    push('spin-ring', '旋转圆环', '圆环缺口旋转 · 经典 spinner');
    push('terra', '思考球', '点阵球体旋转 · 参考 TerraWork');
    push('morph', '变形方', '圆 · 三角 · 方形的点阵变形');
    push('grid', '点阵', '九宫格呼吸脉冲');
    push('orbit', '轨道', '光点沿方形轨道环绕');
    push('ripple', '波纹', '方形波纹向外扩散');
    push('wave', '声波', '等宽声波起伏');
    push('pulse-ring', '脉冲环', '单个圆环放大淡出 · 最克制');
    push('breathe-bars', '呼吸条', '三根竖条正弦呼吸');
    push('spin-square', '旋方', '方框旋转并带一个角点');
    push('typing-dots', '打字点', '三点依次点亮 · 经典加载');
    push('scan-line', '扫描线', '方框内横线往返扫描');
  } else if (kind === 'language') {
    push('system', '跟随系统', '');
    push('zh', '简体中文', '');
    push('en', 'English', '');
  } else if (kind === 'mode') {
    push('compact', '简洁', '只显示最终结果');
    push('standard', '标准', '显示主要步骤');
    push('detailed', '详细', '显示每个工具调用');
    push('reading', '阅读', '过程实时折叠成一行摘要，可展开回看');
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
  if (kind === 'session-agent-preset') {
    return 'Agent 预设';
  }
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
  if (kind === 'session-agent-preset') {
    return '预设决定 Agent 使用的工具、提示词与能力。选择后只对新建会话生效。';
  }
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
    Logger.info('[PICKER] choose kind=' + this.kind + ' id=' + option.id);
    if (option.disabled === true) {
      return;
    }
    // 工作步骤展示/收起时机：二级页里就地落库 + 写 AppStorage，
    // 这样对话页的 @StorageProp 立刻重排，不依赖返回设置页的 @Watch 是否触发。
    if (this.kind === 'mode') {
      const mode: string = WorkStepPresentation.normalizeMode(option.id);
      PreferencesStore.get().putString(WorkStepPresentation.MODE_KEY, mode);
      AppStorage.setOrCreate<string>('workStepMode', mode);
    } else if (this.kind === 'timing') {
      const timing: string = WorkStepPresentation.normalizeTiming(option.id);
      PreferencesStore.get().putString(WorkStepPresentation.TIMING_KEY, timing);
      AppStorage.setOrCreate<string>('workStepTiming', timing);
    }
    // 震动等级：选中的瞬间就按该档位震一下，方便感受强弱（与最终保存的档位一致）
    if (this.kind === 'haptics') {
      Haptics.preview(option.id);
    }
    // 其余偏好：二级页就地写 AppStorage，设置页的独立订阅组件立即重绘
    if (this.kind === 'appearance') {
      AppStorage.setOrCreate<string>('appearanceMode', option.id);
    } else if (this.kind === 'status') {
      AppStorage.setOrCreate<string>('statusAppearance', option.id);
    } else if (this.kind === 'procion') {
      AppStorage.setOrCreate<string>('procIconStyle', option.id);
    } else if (this.kind === 'language') {
      AppStorage.setOrCreate<string>('appLanguage', option.id);
    } else if (this.kind === 'haptics') {
      AppStorage.setOrCreate<string>('hapticsLevel', option.id);
    } else if (this.kind === 'glass') {
      AppStorage.setOrCreate<string>('glassStylePreset', option.id);
    } else if (this.kind === 'native') {
      AppStorage.setOrCreate<string>('nativeStylePreset', option.id);
    } else if (this.kind === 'card') {
      AppStorage.setOrCreate<string>('cardStylePreset', option.id);
    }
    // 其余偏好仍交给设置页处理（写入偏好 + 应用主题等既有逻辑）
    AppStorage.setOrCreate<string>('prefPickerChoice', this.kind + SEP + option.id);
    // 递增偏好版本号：设置页监听它刷新行文案（@StorageProp 单独变化在本机不一定触发重绘）
    const revision: number = AppStorage.get<number>('prefPickerRevision') ?? 0;
    AppStorage.setOrCreate<number>('prefPickerRevision', revision + 1);
    this.pageStack.pop();
  }

  /** 界面选项的迷你界面预览：light=浅色主题小屏，half=跟随系统的对半布局 */
  @Builder
  themeMock(light: boolean, half: boolean) {
    Column() {
      Row()
        .width(half ? 12 : 18)
        .height(4.5)
        .borderRadius(2.25)
        .backgroundColor(light ? 'rgba(16,19,24,0.20)' : 'rgba(241,244,250,0.25)')
      Row()
        .width(half ? 16 : 34)
        .height(4)
        .borderRadius(2)
        .backgroundColor(light ? 'rgba(16,19,24,0.11)' : 'rgba(241,244,250,0.14)')
        .margin({ top: 6 })
      Row()
        .width(half ? 9 : 22)
        .height(4)
        .borderRadius(2)
        .backgroundColor(light ? 'rgba(16,19,24,0.11)' : 'rgba(241,244,250,0.14)')
        .margin({ top: 4 })
    }
    .width(half ? 32 : 64)
    .height('100%')
    .backgroundColor(light ? '#F7F9FC' : '#16181D')
    .borderRadius(light
      ? { topLeft: 6, bottomLeft: 6, topRight: half ? 0 : 6, bottomRight: half ? 0 : 6 }
      : { topRight: 6, bottomRight: 6, topLeft: half ? 0 : 6, bottomLeft: half ? 0 : 6 })
    .padding({ top: 8, left: 8, right: 8, bottom: 8 })
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    NavDestination() {
      Column() {
        // 导航：返回 + 居中标题（与「设置」「对话状态条」等二级页一致）
        Row() {
          NavBackButton({ isDark: this.isDark })
            .onClick(() => {
              this.pageStack.pop();
            })

          Text(titleFor(this.kind))
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .textAlign(TextAlign.Center)

          Row().width(44).height(44)
        }
        .width('100%')
        .height(56)
        // 左右与内容一致（内容区 padding 18.7）
        .padding({ left: 18.7, right: 18.7 })

        Scroll() {
          Column() {
            // 说明（小程序 status-style-hint）：标题已上移到导航栏居中显示
            if (subtitleFor(this.kind).length > 0) {
              Text(subtitleFor(this.kind))
                .fontSize(14) // 24rpx
                .fontColor(this.subColor())
                .width('100%')
                .padding({ bottom: 14 })
            }

            // 选项卡片：每张 = 标题行 + 动效预览 + 描述（对齐 .status-style-option）
            ForEach(optionsFor(this.kind), (option: PickerOption) => {
              Column({ space: 0 }) {
                Row() {
                  Text(option.label)
                    .fontSize(16.4) // 28rpx
                    .fontWeight(FontWeight.Medium)
                    .fontColor(option.disabled === true ? this.subColor() : this.textColor())
                  Blank()
                  Text(option.id === this.currentValue ? '已选择' : '')
                    .fontSize(12.9) // 22rpx
                    .fontColor('#5676C8')
                }
                .width('100%')

                // 预览行：按当前设置类型渲染——执行图标=动效预览；界面=深浅色色块；其余类型无预览
                if (this.kind === 'procion') {
                  Row({ space: 10 }) {
                    ProcLoaderView({ style: option.id, isDark: this.isDark, boxSize: 18.77 })
                    Text('正在执行命令')
                      .fontSize(14)
                      .fontColor(this.textColor())
                  }
                  .width('100%')
                  .margin({ top: 13, bottom: 8 })
                  .alignItems(VerticalAlign.Center)
                } else if (this.kind === 'appearance') {
                  Row({ space: 10 }) {
                    // 迷你界面预览：跟随系统=左浅右深对半小屏，浅色/深色=整块小屏
                    Row() {
                      if (option.id !== 'dark') {
                        this.themeMock(true, option.id === 'auto')
                      }
                      if (option.id !== 'light') {
                        this.themeMock(false, option.id === 'auto')
                      }
                    }
                    .width(64)
                    .height(40)
                    .borderRadius(6)
                    .clip(true)
                    .border({ width: 1, color: this.dividerColor(), radius: 6 })

                    Text(option.id === 'auto' ? '跟随系统深浅色' : (option.id === 'light' ? '浅色界面' : '深色界面'))
                      .fontSize(14)
                      .fontColor(this.textColor())
                  }
                  .width('100%')
                  .margin({ top: 13, bottom: 8 })
                  .alignItems(VerticalAlign.Center)
                }

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

            // 添加自定义 Agent 预设：仅当网关提供 cordis 创造模式时展示（对齐小程序 preset-create-entry）
            if (this.kind === 'session-agent-preset'
              && (AppStorage.get<boolean>('sessionPresetCreatorAvailable') ?? false)) {
              Column({ space: 6 }) {
                Row({ space: 10 }) {
                  Text('＋')
                    .fontSize(18)
                    .fontWeight(FontWeight.Bold)
                    .fontColor('#2E6BE6')
                  Text('添加自定义 Agent 预设')
                    .fontSize(16)
                    .fontColor(this.textColor())
                }
                .alignItems(VerticalAlign.Center)
                Text('新建创造模式会话，让 Agent 创建或维护预设')
                  .fontSize(12.5)
                  .fontColor(this.subColor())
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding(14)
              .borderRadius(14)
              .border({ width: 1, style: BorderStyle.Dashed, color: '#2E6BE6' })
              .onClick(() => {
                this.choose({ id: '__create__', label: '', detail: '', disabled: false });
              })
            }

            Text(this.kind === 'procion' ? '动效保存在当前 App · 自动保存' : '保存在当前 App · 自动保存')
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
