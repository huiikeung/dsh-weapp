/**
 * 二级页面的返回按钮（鸿蒙原生写法）。
 *
 * 边缘和阴影对齐「⋯」「协作」系统菜单容器：
 *   bindMenu 那边就是 outlineColor: dividerColor() + outlineWidth: 1，
 *   也就是深色白 16% / 浅色黑 10% 的中性 1vp 细边，配系统菜单那种柔和投影。
 *   底色用中性玻璃（不偏蓝），不加外发光——菜单本身也没有发光。
 */
import { Logger } from 'nativecore';
import { HdsGlassSurface } from './HdsGlassSurface';

@Component
export struct NavBackButton {
  /** 深色主题 */
  @Prop isDark: boolean = false;
  /** 无障碍文案 */
  @Prop label: string = '返回';
  /** 是否显示玻璃底（对话框内嵌等场景可关掉） */
  @Prop glass: boolean = true;
  /** 圆钮直径（对话页顶栏与右侧 36vp 小圆钮保持一致） */
  @Prop diameter: number = 40;
  /**
   * 自定义返回动作：提供时不走默认 pop（例如 Bot 聊天页需要先关闭会话再退栈）。
   * 用普通成员而不是 @Prop —— API 23 起 @Prop 不能修饰函数类型。
   */
  onBack?: () => void;

  /** 箭头颜色：与页面正文同色系 */
  private ink(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  /** 玻璃底：深色中性深灰 / 浅色半透明白（保持原样不动） */
  private glassTint(): string {
    return this.isDark ? 'rgba(44,44,48,0.46)' : 'rgba(255,255,255,0.24)';
  }

  /**
   * 原生弹窗同款材质：直接用系统模糊样式（AlertDialog / 菜单就用它），
   * 不再自绘 backdropBlur + 白色 1vp 描边 —— 浅色下那圈 90% 白边就是它造成的。
   */
  build() {
    Stack({ alignContent: Alignment.Center }) {
      // 玻璃背板：与首页圆钮同一套 HdsGlassSurface（HdsTabs 悬浮 Bar 出真材质），
      // 因此设置页的「玻璃材质」档位对返回键同样生效。
      if (this.glass) {
        HdsGlassSurface() {
          Row()
            .width(this.diameter)
            .height(this.diameter)
            .backgroundColor(Color.Transparent)
        }
      }
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.chevron_backward'))
          .fontSize(this.diameter * 0.45)
          .fontColor([this.ink()])
          .fontWeight(FontWeight.Medium)
      }
      .width(this.diameter)
      .height(this.diameter)
      .backgroundColor(Color.Transparent)
      .accessibilityText(this.label)
      // 返回逻辑内置：不依赖各页面自己挂 onClick（漏挂/被覆盖时点了没反应）
      .onClick(() => {
        if (this.onBack !== undefined) {
          this.onBack();
          return;
        }
        const stack: NavPathStack | undefined = AppStorage.get<NavPathStack>('navPathStack');
        if (stack !== undefined && stack.size() > 0) {
          Logger.info('nav back pop size=' + stack.size().toString());
          stack.pop();
        } else {
          Logger.warn('nav back: pageStack empty/unavailable');
        }
      })
    }
    .width(this.diameter)
    .height(this.diameter)
  }
}
