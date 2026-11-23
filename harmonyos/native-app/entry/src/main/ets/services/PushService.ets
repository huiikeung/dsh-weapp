import { pushService } from '@kit.PushKit';
import { common } from '@kit.AbilityKit';
import { Logger } from 'nativecore';

/**
 * PushService — 华为 Push Kit 客户端接入（修复「App 后台/被杀收不到主机指令」）。
 *
 * 工作方式：向系统申请 pushToken 并上报网关；主机侧要下发指令而 WebSocket 不在线时，
 * 通过华为推送服务把唤醒消息发到该 token，系统拉起 App → 自动重连 → 补收指令。
 *
 * ⚠️ 前置条件（只能在 AGC 控制台完成，代码无法替代）：
 *   1. App 在 AGC（AppGallery Connect）建项目并开通「推送服务」；
 *   2. 使用与 AGC 项目关联的签名证书打包（未关联时 getToken 会失败，本服务静默降级）；
 *   3. 主机/中继侧实现推送发送（服务端 REST，需 AGC 的推送凭据），见
 *      docs/push-server.md（本提交附带的服务端接入说明）。
 */
export class PushService {
  private static token: string = '';
  private static reported: boolean = false;

  static currentToken(): string {
    return PushService.token;
  }

  /**
   * 启动时调用：拿 token（失败静默——未在 AGC 关联证书的包拿不到，属预期）。
   */
  static async init(): Promise<void> {
    if (PushService.token.length > 0) {
      return;
    }
    try {
      const token: string = await pushService.getToken();
      if (token.length === 0) {
        Logger.info('PUSH token empty (AGC 未关联或设备不支持)');
        return;
      }
      PushService.token = token;
      Logger.info('PUSH token acquired len=' + token.length.toString());
      await PushService.reportToken();
    } catch (err) {
      // 907122701 等：AGC 未开通推送/签名未关联。静默降级，不影响其他功能。
      Logger.warn('PUSH getToken failed: ' + (err as Error).message);
    }
  }

  /**
   * 把 token 报给网关：连接建立后（onConnected）也会再次调用，
   * 网关侧把 deviceId→pushToken 存下来，供「指令下发时 App 不在线」场景使用。
   */
  static async reportToken(): Promise<void> {
    if (PushService.token.length === 0 || PushService.reported) {
      return;
    }
    const context: common.UIAbilityContext | undefined =
      AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
    if (context === undefined) {
      return;
    }
    try {
      // 复用现有 WebSocket 通道上报；帧类型 push-token，网关插件按需消费（未升级网关时忽略无害）
      const frame: string = JSON.stringify({
        type: 'push-token',
        platform: 'harmonyos',
        token: PushService.token
      });
      const sent: boolean = GatewaySendBridge.send(frame);
      if (sent) {
        PushService.reported = true;
        Logger.info('PUSH token reported to gateway');
      }
    } catch (err) {
      Logger.warn('PUSH report failed: ' + (err as Error).message);
    }
  }

  /** 连接重建后允许重新上报（网关重启会丢 token 表） */
  static resetReported(): void {
    PushService.reported = false;
  }
}

/**
 * 网关发送桥：避免直接依赖 GatewayClient 单例时序，
 * EntryAbility 在连接建立后 setGateway 一次。
 */
export class GatewaySendBridge {
  private static sendFn: ((text: string) => boolean) | undefined = undefined;

  static setGateway(send: (text: string) => boolean): void {
    GatewaySendBridge.sendFn = send;
  }

  static send(text: string): boolean {
    const fn = GatewaySendBridge.sendFn;
    return fn !== undefined ? fn(text) : false;
  }
}
