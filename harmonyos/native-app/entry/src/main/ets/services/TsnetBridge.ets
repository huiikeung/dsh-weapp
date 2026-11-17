import {
  hello,
  probeEngine,
  backendStart,
  backendStop,
  backendLogout,
  backendStatus,
  backendAuthURL,
  backendVpnConfig,
  backendPeers,
  backendAccount,
  backendExitNodes,
  backendRestartWithTun,
  tailscaleVersion,
  proxyStart,
  proxyStop,
  fastStart,
  fastStatus,
  fastAuthURL,
  fastStop,
  fastDebug,
  fastWarm,
  fastProxyStart
} from 'libtailscale_ohos.so';

/** 内嵌 Tailscale（tsnet/tsd）Go 引擎桥：由 libtailscale_go.so 提供，NAPI 直连。 */
export class TsnetBridge {
  static available(): boolean {
    try {
      const text: string = hello();
      return text.indexOf('OK') >= 0;
    } catch (err) {
      return false;
    }
  }

  static hello(): string {
    try {
      return hello();
    } catch (err) {
      return 'FAILED | bridge unavailable';
    }
  }

  static version(): string {
    try {
      return tailscaleVersion();
    } catch (err) {
      return '';
    }
  }

  static probeEngine(): string {
    try {
      return probeEngine();
    } catch (err) {
      const message: string = (err as Error).message;
      return 'FAILED | probe | ' + message;
    }
  }

  static start(stateDir: string, deviceModel: string, osVersion: string, controlURL: string): string {
    try {
      return backendStart(stateDir, deviceModel, osVersion, controlURL);
    } catch (err) {
      return 'FAILED | backendStart | ' + (err as Error).message;
    }
  }

  static restartWithTun(stateDir: string, deviceModel: string, osVersion: string,
    controlURL: string, fd: number): string {
    try {
      return backendRestartWithTun(stateDir, deviceModel, osVersion, controlURL, fd);
    } catch (err) {
      return 'FAILED | restartWithTun | ' + (err as Error).message;
    }
  }

  static stop(): string {
    try {
      return backendStop();
    } catch (err) {
      return 'FAILED | backendStop | ' + (err as Error).message;
    }
  }

  static logout(): string {
    try {
      return backendLogout();
    } catch (err) {
      return 'FAILED | backendLogout | ' + (err as Error).message;
    }
  }

  static status(): string {
    try {
      return backendStatus();
    } catch (err) {
      return 'FAILED | backendStatus | ' + (err as Error).message;
    }
  }

  static authURL(): string {
    try {
      return backendAuthURL();
    } catch (err) {
      return '';
    }
  }

  static vpnConfig(): string {
    try {
      return backendVpnConfig();
    } catch (err) {
      return '';
    }
  }

  static peers(): string {
    try {
      return backendPeers();
    } catch (err) {
      return '';
    }
  }

  static account(): string {
    try {
      return backendAccount();
    } catch (err) {
      return '';
    }
  }

  /** 启动应用内 tailnet 代理（127.0.0.1:listenPort → tailnet 目标），不占用系统 VPN */
  /** 轻量 tsnet 引擎启动（fresh 状态目录，首次需登录一次） */
  static startFast(hostname: string, stateDir: string, controlURL: string, authKey: string): string {
    try {
      return fastStart(hostname, stateDir, controlURL, authKey);
    } catch (err) {
      return 'FAILED | fastStart | ' + (err as Error).message;
    }
  }

  static statusFast(): string {
    try {
      return fastStatus();
    } catch (err) {
      return 'FAILED | fastStatus | ' + (err as Error).message;
    }
  }

  static authURLFast(): string {
    try {
      return fastAuthURL();
    } catch (err) {
      return '';
    }
  }

  static warmFast(targetHost: string, targetPort: number): string {
    try {
      return fastWarm(targetHost, targetPort);
    } catch (err) {
      return '';
    }
  }

  static debugFast(): string {
    try {
      return fastDebug();
    } catch (err) {
      return '';
    }
  }

  static stopFast(): string {
    try {
      return fastStop();
    } catch (err) {
      return '';
    }
  }

  /** 轻量引擎版的 ws 地址本地代理 */
  static startFastProxyForWsUrl(url: string, localPort: number): string {
    let tls: number = 0;
    let rest: string = url;
    if (rest.startsWith('wss://') || rest.startsWith('https://')) {
      tls = 1;
    }
    const schemeIndex: number = rest.indexOf('://');
    if (schemeIndex >= 0) {
      rest = rest.substring(schemeIndex + 3);
    }
    let pathAndQuery: string = '';
    const slash: number = rest.indexOf('/');
    if (slash >= 0) {
      pathAndQuery = rest.substring(slash);
      rest = rest.substring(0, slash);
    }
    let port: number = tls === 1 ? 443 : 80;
    const colon: number = rest.lastIndexOf(':');
    if (colon > 0) {
      port = Number.parseInt(rest.substring(colon + 1), 10);
      rest = rest.substring(0, colon);
    }
    if (rest.length === 0 || Number.isNaN(port)) {
      return '';
    }
    const result: string = fastProxyStart(rest, port, localPort, tls);
    if (result.startsWith('OK')) {
      return 'ws://127.0.0.1:' + localPort + pathAndQuery;
    }
    return '';
  }

  static proxyStart(targetHost: string, targetPort: number, listenPort: number, useTLS: number): string {
    try {
      return proxyStart(targetHost, targetPort, listenPort, useTLS);
    } catch (err) {
      return 'FAILED | proxyStart | ' + (err as Error).message;
    }
  }

  /** 针对 tailnet 网关地址（100.x / *.ts.net）启动本地代理，返回可连接的本机 ws 地址 */
  static startProxyForWsUrl(url: string, localPort: number): string {
    let tls: number = 0;
    let rest: string = url;
    if (rest.startsWith('wss://') || rest.startsWith('https://')) {
      tls = 1;
    }
    const schemeIndex: number = rest.indexOf('://');
    if (schemeIndex >= 0) {
      rest = rest.substring(schemeIndex + 3);
    }
    let pathAndQuery: string = '';
    const slash: number = rest.indexOf('/');
    if (slash >= 0) {
      pathAndQuery = rest.substring(slash);
      rest = rest.substring(0, slash);
    }
    let port: number = tls === 1 ? 443 : 80;
    const colon: number = rest.lastIndexOf(':');
    if (colon > 0) {
      port = Number.parseInt(rest.substring(colon + 1), 10);
      rest = rest.substring(0, colon);
    }
    if (rest.length === 0 || Number.isNaN(port)) {
      return '';
    }
    const result: string = TsnetBridge.proxyStart(rest, port, localPort, tls);
    if (result.startsWith('OK')) {
      return 'ws://127.0.0.1:' + localPort + pathAndQuery;
    }
    return '';
  }

  static proxyStop(): string {
    try {
      return proxyStop();
    } catch (err) {
      return 'FAILED | proxyStop | ' + (err as Error).message;
    }
  }

  static exitNodes(): string {
    try {
      return backendExitNodes();
    } catch (err) {
      return '';
    }
  }
}
