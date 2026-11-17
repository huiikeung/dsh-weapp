import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { common, wantAgent } from '@kit.AbilityKit';
import type { WantAgent } from '@kit.AbilityKit';
import { Logger } from 'nativecore';

/**
 * 后台保活：用系统长时任务（dataTransfer）让隧道引擎在 App 进入后台后继续运行，
 * 回到前台/切换网络时不需要冷启动（Tailscale 控制面握手约 8s 只在冷启动时发生）。
 * 需要 ohos.permission.KEEP_BACKGROUND_RUNNING 与 module.json5 的 backgroundModes。
 */
export class BackgroundKeepAlive {
  private static running: boolean = false;
  private static context: common.UIAbilityContext | undefined = undefined;

  static async start(context: common.UIAbilityContext): Promise<void> {
    if (BackgroundKeepAlive.running) {
      return;
    }
    BackgroundKeepAlive.context = context;
    try {
      const info: wantAgent.WantAgentInfo = {
        wants: [{ bundleName: 'com.whaletail.app', abilityName: 'EntryAbility' }],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: 0,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      };
      const agent: WantAgent = await wantAgent.getWantAgent(info);
      await backgroundTaskManager.startBackgroundRunning(context, backgroundTaskManager.BackgroundMode.DATA_TRANSFER, agent);
      BackgroundKeepAlive.running = true;
      Logger.info('BGKEEP started');
    } catch (err) {
      Logger.warn('BGKEEP start failed: ' + (err as Error).message);
    }
  }

  static async stop(): Promise<void> {
    if (!BackgroundKeepAlive.running || BackgroundKeepAlive.context === undefined) {
      return;
    }
    try {
      await backgroundTaskManager.stopBackgroundRunning(BackgroundKeepAlive.context);
      Logger.info('BGKEEP stopped');
    } catch (err) {
      Logger.warn('BGKEEP stop failed: ' + (err as Error).message);
    }
    BackgroundKeepAlive.running = false;
  }
}
