# dsh-weapp 公网中继方案（relay + E2EE）

解决微信小程序「socket 合法域名不允许带端口」的限制：fnOS 上的 dsh-plugin-weapp-gateway
不需要暴露公网端口，由 fnOS **出站连接** VPS 上的中继，小程序连接中继的标准 443 端口，
中继只转发端到端加密的密文。

```text
┌────────────────────┐  出站 wss（无需开端口）  ┌───────────────┐  wss 443  ┌────────────┐
│ fnOS               │ ─────────────────────▶ │ VPS 中继       │ ◀──────── │ 微信小程序  │
│ agent-connector    │                        │ relay-server   │           │ dsh-weapp  │
│ ↕ ws://127.0.0.1:16662/ws/mobile            │ （只见密文）    │           │ E2EE       │
│ dsh-plugin-weapp-gateway                    └───────────────┘           └────────────┘
└────────────────────┘
```

加密方案（与 dsh-wechat-remote 的 E2EE v1 同一套原语）：

- 身份：fnOS 首次运行生成 **Ed25519 密钥对**（`~/.dsh-weapp-relay/identity.json`），
  公钥进入配对二维码；每次会话再生成临时 **X25519** 密钥对。
- 握手：小程序 ClientHello → agent 回 AgentHello 并用身份私钥对 transcript 签名，
  小程序用二维码里的公钥**验签**，中继无法中间人。
- 传输：`nacl.box.before`（X25519 ECDH）派生对称密钥，`nacl.secretbox`
  （XSalsa20-Poly1305）+ 单调计数器 nonce，防重放。
- 中继全程只见二进制密文与路由信息（nodeId），无法解密任何业务帧。

---

## 一、VPS：部署中继

要求：Node 18+，一个已解析到 VPS 的域名（小程序要求 wss + 域名，端口必须是 443）。

```bash
# 单独部署时上传仓库 dsh-console/relay/ 目录到 VPS，例如 /opt/dsh-relay
cd /opt/dsh-relay
npm install --omit=dev
```

systemd 常驻（`/etc/systemd/system/dsh-relay.service`）：

```ini
[Unit]
Description=DSH Weapp Relay
After=network.target

[Service]
WorkingDirectory=/opt/dsh-relay
Environment=RELAY_HOST=127.0.0.1
Environment=RELAY_PORT=8787
ExecStart=/usr/bin/node relay-server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now dsh-relay
```

nginx TLS 反代（443 → 127.0.0.1:8787，证书可用 certbot 签发）：

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;          # 换成你的域名

    # ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location ~ ^/(a|c)/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

小程序后台「开发设置 → 服务器域名 → socket 合法域名」填 `wss://relay.example.com`
（域名需 ICP 备案；开发阶段在工具里勾选「不校验合法域名」可先用）。

## 二、fnOS：部署连接器

要求：Node 18+，且 dsh-plugin-weapp-gateway 在本机监听（默认 `ws://127.0.0.1:16662/ws/mobile`）。

```bash
# 上传仓库 dsh-console/relay/ 目录到 fnOS，例如 /volume1/app/dsh-relay
cd /volume1/app/dsh-relay
npm install --omit=dev
node agent-connector.js --relay wss://relay.example.com \
                        --gateway ws://127.0.0.1:16662/ws/mobile \
                        --name "我的 fnOS"
```

首次运行会：

1. 生成 `~/.dsh-weapp-relay/identity.json`（nodeId + Ed25519 身份密钥，**妥善保管**）；
2. 中继签发 5 分钟有效、一次性使用的所有者邀请，连接器打印 Base64URL **配对载荷**；
3. 出站连上中继并保持长连接。

常驻运行（fnOS 计划任务或 docker，示例 systemd）：

```ini
[Unit]
Description=DSH Weapp Connector
After=network.target

[Service]
ExecStart=/usr/bin/node /volume1/app/dsh-relay/agent-connector.js --relay wss://relay.example.com --gateway ws://127.0.0.1:16662/ws/mobile
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## 三、小程序配对

1. 把配对载荷字符串做成二维码（任意二维码生成器），或直接复制字符串；
2. 打开 dsh-weapp 小程序 → 公网节点 → 扫码，或粘到配对信息输入框；
3. 小程序以一次性邀请连接中继，换取设备访问令牌后完成 E2EE 握手（验签 fnOS 身份）；
4. 所有者可在设置页生成 1 小时、1 天或 7 天的访客分享；访客邀请只能消费一次，访问令牌到期后自动失效。

注意：首次配对载荷有效期为 5 分钟且仅能使用一次。过期或已使用时请重启连接器，等待其打印新的所有者配对信息。删除中继的 `relay-state.json` 会撤销所有设备令牌和邀请。

## 四、测试

```bash
cd relay
npm install
node e2e-test.mjs    # 13 项端到端检查（握手/验签/密文往返/token 捕获/子协议透传/离线拒绝）
```

## 五、文件清单

| 文件 | 位置 | 作用 |
| --- | --- | --- |
| `relay-server.js` | VPS | 中继：agent 注册 + 客户端 1:1 管道，只见密文 |
| `agent-connector.js` | fnOS | 出站连中继、桥接本地网关、E2EE 解密、token 注入 |
| `utils/relay-e2ee.js` | 小程序 | 客户端 E2EE 会话（握手/验签/加解密，无外部依赖纯 JS） |
| `utils/nacl.min.js` | 小程序 | tweetnacl 1.0.3 |
| `e2e-test.mjs` | 本地 | 端到端回归测试 |

## 六、已知边界（v1）

- 中继通过一次性邀请换发访问令牌，并按 bridgeId 隔离并发客户端管道；业务帧仍由 E2EE 保护。
- 多台设备各自运行一份 connector（各自 nodeId）即可多人使用。
