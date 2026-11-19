import { common } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { Logger } from 'nativecore';

/** 首页（NavBar）在路由表里的名字：空串代表首页 */
export const STATUS_BAR_HOME_ROUTE: string = '';

/**
 * 状态栏内容色统一入口。
 *
 * 这套颜色在鸿蒙上会被系统异步改写：
 * 1) `setColorMode()`（设置里切浅色/深色）会按新 colorMode 重刷（DARK → 白、LIGHT → 黑）；
 * 2) 前后台切换、系统配色变化同样会重刷。
 * 页面已经显示时 onShown 不会再触发，于是出现「首页深海背景 + 黑色状态栏文字」。
 *
 * 反过来，如果只记住「首页要白」，浅色二级页面（设置等）会变成白字压浅底，同样看不见。
 * 所以颜色由「当前显示的页面」决定，页面归属通过 Navigation.setInterception(didShow) 统一上报：
 * - 首页（NavBar）：恒定白色，因为首页背景恒为深海深色；
 * - 其它页面：跟随主题 isDark（深色 → 白、浅色 → 黑）。
 */
export class StatusBarStyle {
  /** 当前显示的 NavDestination 名字；空串 = 首页 */
  private static route: string = STATUS_BAR_HOME_ROUTE;

  /** 路由变化（didShow）或页面主动刷新时调用 */
  static setRoute(routeName: string): void {
    const next: string = routeName === undefined ? STATUS_BAR_HOME_ROUTE : routeName;
    if (next !== StatusBarStyle.route) {
      Logger.info('SB route ' + (StatusBarStyle.route.length > 0 ? StatusBarStyle.route : 'home') +
        ' -> ' + (next.length > 0 ? next : 'home'));
      StatusBarStyle.route = next;
    }
    StatusBarStyle.refresh();
  }

  /** 直接指定颜色（对话页自己按 isDark 算颜色时用） */
  static set(contentColor: string): void {
    StatusBarStyle.applyWithRetry(contentColor);
  }

  /** 按「当前页面 + 当前主题」重新计算并写回颜色 */
  static refresh(): void {
    StatusBarStyle.applyWithRetry(StatusBarStyle.resolveColor());
  }

  private static resolveColor(): string {
    // 首页恒为深海深色背景 → 白字
    if (StatusBarStyle.route === STATUS_BAR_HOME_ROUTE) {
      return '#FFFFFF';
    }
    const isDark: boolean = AppStorage.get<boolean>('isDark') ?? true;
    return isDark ? '#FFFFFF' : '#000000';
  }

  /** 系统重置是异步的，按 0/100/400/1000ms 重试四次压过它 */
  private static applyWithRetry(contentColor: string): void {
    const write = (): void => {
      StatusBarStyle.write(contentColor);
    };
    write();
    setTimeout(write, 100);
    setTimeout(write, 400);
    setTimeout(write, 1000);
  }

  private static write(contentColor: string): void {
    try {
      const ctx: common.UIAbilityContext | undefined =
        AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
      if (ctx === undefined) {
        return;
      }
      window.getLastWindow(ctx).then((win: window.Window) => {
        win.setWindowSystemBarProperties({ statusBarContentColor: contentColor });
      }).catch((err: Error) => {
        Logger.error('status bar write failed: ' + err.message);
      });
    } catch (err) {
      Logger.error('status bar write threw: ' + String(err));
    }
  }
}
