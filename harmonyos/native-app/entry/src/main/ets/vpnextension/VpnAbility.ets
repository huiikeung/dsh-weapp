import VpnExtensionAbility from '@ohos.app.ability.VpnExtensionAbility';
import type Want from '@ohos.app.ability.Want';
import { connection, vpnExtension } from '@kit.NetworkKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { Logger, WireGuardTunnel } from 'nativecore';
import type { WireGuardPeerConfig } from 'nativecore';

/**
 * Tailscale / WireGuard 隧道入口。
 *
 * 职责：
 * 1. 创建系统 VPN + TUN 虚拟网卡（拿到 vNIC fd）
 * 2. 从 fd 读取 IP 包，交给 WireGuard 隧道加密后经 UDP 发出
 * 3. 反向：UDP 收到的包解密后写回 TUN
 */
export default class VpnAbility extends VpnExtensionAbility {
  private tunnel: vpnExtension.VpnConnection | undefined = undefined;
  private wg: WireGuardTunnel | undefined = undefined;
  private tunFile: fileIo.File | undefined = undefined;
  private running: boolean = false;

  onCreate(want: Want): void {
    // Do not install routes until the backend is authenticated and functional.
    Logger.warn('VPNEXT experimental backend disabled');
  }

  private async startTunnel(): Promise<void> {
    const conn: vpnExtension.VpnConnection = vpnExtension.createVpnConnection(this.context);
    this.tunnel = conn;

    const localAddr: connection.NetAddress = { address: '100.64.0.1', family: 1 };
    const link: connection.LinkAddress = { address: localAddr, prefixLength: 32 };
    const dest: connection.LinkAddress = {
      address: { address: '100.64.0.0', family: 1 },
      prefixLength: 10
    };
    const gateway: connection.NetAddress = { address: '0.0.0.0', family: 1 };
    const route: connection.RouteInfo = {
      interface: 'vpn',
      destination: dest,
      gateway: gateway,
      hasGateway: false,
      isDefaultRoute: false
    };
    const config: vpnExtension.VpnConfig = {
      addresses: [link],
      routes: [route],
      dnsAddresses: ['100.100.100.100'],
      mtu: 1280,
      isIPv4Accepted: true,
      isIPv6Accepted: false,
      isInternal: false,
      isBlocking: false
    };

    const fd: number = await conn.create(config);
    Logger.info('VPNEXT tun ready fd=' + fd);

    // 复制 fd 供读取（原 fd 由 VPN 服务持有）
    this.tunFile = fileIo.dup(fd);
    Logger.info('VPNEXT tun dup ok fd=' + this.tunFile.fd);

    await this.startWireGuard(conn);
    this.startTunReader();
  }

  /** 建立 WireGuard 隧道（当前为自检配置，后续由 Tailscale 控制面下发） */
  private async startWireGuard(conn: vpnExtension.VpnConnection): Promise<void> {
    // 测试配置（临时硬编码，后续由 Tailscale 控制面下发）
    const b64: util.Base64Helper = new util.Base64Helper();
    const privateKey: Uint8Array = b64.decodeSync('mBgWNp8aRCjjw3tgWj73G0PC2x9R60vAB1hxt8TSfnU=');
    const peerPublic: Uint8Array = b64.decodeSync('bSmsZ51RRzZuX8Poq5Wwe61tFfH1e/JII5schNwpTVU=');

    const cfg: WireGuardPeerConfig = {
      privateKey: privateKey,
      peerPublicKey: peerPublic,
      endpointHost: '192.168.3.187',
      endpointPort: 51820
    };

    const wg: WireGuardTunnel = new WireGuardTunnel(
      cfg,
      (sockFd: number): Promise<void> => conn.protect(sockFd),
      (pkt: Uint8Array): void => {
        this.writeTun(pkt);
      }
    );
    this.wg = wg;
    await wg.start();
    Logger.info('VPNEXT wireguard started');
  }

  /** 持续从 TUN 读包 */
  private startTunReader(): void {
    const tun: fileIo.File | undefined = this.tunFile;
    if (tun === undefined) {
      return;
    }
    this.running = true;
    this.readLoop(tun);
  }

  private readLoop(tun: fileIo.File): void {
    if (!this.running) {
      return;
    }
    const buf: ArrayBuffer = new ArrayBuffer(1600);
    fileIo.read(tun.fd, buf).then((n: number) => {
      if (n > 0) {
        const packet: Uint8Array = new Uint8Array(buf, 0, n);
        this.handleTunPacket(packet);
      }
      this.readLoop(tun);
    }).catch((e: Error) => {
      // TUN 是非阻塞设备：无数据时返回 EAGAIN（Try again），继续轮询即可
      const msg: string = e.message;
      if (msg.indexOf('Try again') >= 0 || msg.indexOf('again') >= 0) {
        setTimeout(() => {
          this.readLoop(tun);
        }, 20);
        return;
      }
      Logger.warn('VPNEXT tun read err=' + msg);
      this.running = false;
    });
  }

  private handleTunPacket(packet: Uint8Array): void {
    if (packet.length < 20) {
      return;
    }
    const version: number = (packet[0] >> 4) & 0x0f;
    if (version !== 4) {
      return;
    }
    const wg: WireGuardTunnel | undefined = this.wg;
    if (wg === undefined || !wg.isReady()) {
      return;
    }
    wg.sendPacket(packet).catch((e: Error) => {
      Logger.warn('VPNEXT send failed: ' + e.message);
    });
  }

  /** 把解密后的 IP 包写回 TUN */
  private writeTun(packet: Uint8Array): void {
    const tun: fileIo.File | undefined = this.tunFile;
    if (tun === undefined) {
      return;
    }
    const buf: ArrayBuffer = packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength);
    fileIo.write(tun.fd, buf).catch((e: Error) => {
      Logger.warn('VPNEXT tun write err=' + e.message);
    });
  }

  onDestroy(): void {
    Logger.info('VPNEXT onDestroy');
    this.running = false;
    const wg: WireGuardTunnel | undefined = this.wg;
    this.wg = undefined;
    if (wg !== undefined) {
      wg.stop().catch(() => {
      });
    }
    const conn: vpnExtension.VpnConnection | undefined = this.tunnel;
    this.tunnel = undefined;
    if (conn !== undefined) {
      conn.destroy().then(() => {
        Logger.info('VPNEXT tun destroyed');
      }).catch(() => {
      });
    }
  }
}
