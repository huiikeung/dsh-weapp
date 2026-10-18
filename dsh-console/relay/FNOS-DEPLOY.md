# fnOS 对接方案：dsh-weapp 公网中继连接器（agent-connector）

> 本文档是给 fnOS AI / 管理员的完整执行说明。目标：在 fnOS 上部署
> `agent-connector.js`，让它作为**出站客户端**连接 VPS 上的中继服务器，
> 把微信小程序的加密流量桥接到本机的 dsh-plugin-weapp-gateway。
> **fnOS 不需要对公网开放任何端口。**

---

## 1. 架构与原理

```text
微信小程序 ──wss(443)──▶ VPS 中继(relay-server) ◀──出站 wss── fnOS connector
      E2EE 加密              只转发密文，无法解密         ↕ 本机回环
                                          ws://192.168.x.x:3081/ws/mobile
                                          dsh-plugin-weapp-gateway
```

- `agent-connector.js` 是唯一需要在 fnOS 上运行的组件（Node.js，约 300 行，依赖 `ws` + `tweetnacl`）。
- 连接方向永远是 fnOS → 中继（出站），路由器/防火墙**无需任何端口映射**。
- 加密：小程序与 connector 之间端到端加密（Ed25519 身份验签 + X25519 ECDH + XSalsa20-Poly1305），中继只见密文。
- 首次配对后，网关的长期 token 由 connector 自动捕获并保存，之后**免扫码**重连。

## 2. 前置条件（部署前检查）

| 项目 | 要求 | 检查命令 |
| --- | --- | --- |
| Node.js | ≥ 18（fnOS 应用中心或手动安装） | `node -v` |
| dsh-plugin-weapp-gateway |  已在本机运行并监听 | `curl -si http://192.168.x.x:3081/ws/mobile \| head -1`（有 HTTP 响应即可） |
| 出站网络 | 能访问 VPS 的 443 端口 | `curl -sI https://<中继域名> \| head -1` |
| VPS 中继 | relay-server.js 已部署并可被 wss 访问 | 由 VPS 侧完成（不在本方案范围） |

**向用户确认两个参数后再继续：**
1. 中继地址（形如 `wss://relay.example.com`）
2. 网关地址（形如 `ws://192.168.x.x:3081/ws/mobile`，把 `192.168.x.x` 换成 fnOS 内网实际 IP，端口不同需修改）

## 3. 文件与目录

需要的文件（随项目提供，位于仓库 `dsh-console/relay/` 目录）：

```text
relay/
├── agent-connector.js    # 本方案的主角
├── relay-server.js       # 不需要在 fnOS 运行（VPS 用），可不上传
├── package.json          # 依赖清单
└── README-relay.md       # 总体文档（VPS 部分在 VPS 上执行）
```

建议部署位置：`/volume1/app/dsh-relay/`（fnOS 常见存储卷路径，若卷名不同请按实际调整，下同）。

## 4. 部署步骤

### 4.1 上传并安装依赖

```bash
mkdir -p /volume1/app/dsh-relay
# 把 agent-connector.js、package.json 上传到该目录（SMB/scp 均可）
cd /volume1/app/dsh-relay
npm install --omit=dev
```

依赖只有两个：`ws@8` 和 `tweetnacl@1`，无编译型依赖，arm64/x86 通用。

### 4.2 手动试运行

```bash
cd /volume1/app/dsh-relay
node agent-connector.js \
  --relay wss://relay.example.com \
  --gateway ws://192.168.x.x:3081/ws/mobile \
  --name "我的 fnOS"
```

预期输出（按顺序）：

```text
[connector ...] 连接中继 wss://relay.example.com/a/<nodeId>
[connector ...] 已注册到中继

===== 配对载荷（Base64URL，可直接粘到小程序手动配对）=====
eyJ2ZXJzaW9uIjozLC...
=========================================================
```

看到配对载荷即代表：出站连接成功、身份已生成。此时按 `Ctrl+C` 退出，进入常驻部署。

首次运行生成的文件（**妥善保管，含私钥**）：

- `~/.dsh-weapp-relay/identity.json` — nodeId + Ed25519 身份密钥 + 设备 ID
- `~/.dsh-weapp-relay/credentials.json` — 首次配对后自动写入的网关长期 token

> 删除 `identity.json` 会更换身份，所有小程序端已保存的主机档案将失效，需重新配对。

### 4.3 常驻运行（三选一，按用户环境决定）

**方式 A：fnOS「计划任务」最简版（推荐，无 docker 时）**

在 fnOS 管理界面创建「计划任务 → 开机执行」，命令：

```bash
cd /volume1/app/dsh-relay && nohup node agent-connector.js \
  --relay wss://relay.example.com \
  --gateway ws://192.168.x.x:3081/ws/mobile \
  --name "我的 fnOS" \
  >> /volume1/app/dsh-relay/connector.log 2>&1 &
```

再创建一个「每天 04:00 执行」的看护任务（进程不在则拉起）：

```bash
pgrep -f agent-connector.js >/dev/null || \
  cd /volume1/app/dsh-relay && nohup node agent-connector.js \
  --relay wss://relay.example.com \
  --gateway ws://192.168.x.x:3081/ws/mobile \
  --name "我的 fnOS" \
  >> /volume1/app/dsh-relay/connector.log 2>&1 &
```

**方式 B：systemd（fnOS 支持 systemd 时优先用这个）**

`/etc/systemd/system/dsh-connector.service`：

```ini
[Unit]
Description=DSH Weapp Connector (E2EE relay bridge)
After=network-online.target
Wants=network-online.target

[Service]
User=<fnOS登录用户名>
WorkingDirectory=/volume1/app/dsh-relay
ExecStart=/usr/bin/node /volume1/app/dsh-relay/agent-connector.js --relay wss://relay.example.com --gateway ws://192.168.x.x:3081/ws/mobile --name 我的 fnOS
Restart=always
RestartSec=5
# Node 路径以 `which node` 为准

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now dsh-connector
systemctl status dsh-connector        # 应为 active (running)
journalctl -u dsh-connector -f        # 实时日志
```

**方式 C：Docker**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY agent-connector.js package.json ./
RUN npm install --omit=dev
ENV STATE_DIR=/data
CMD ["node", "agent-connector.js", "--relay", "wss://relay.example.com", "--gateway", "ws://192.168.x.x:3081/ws/mobile"]
```

```bash
docker build -t dsh-connector /volume1/app/dsh-relay/
docker run -d --name dsh-connector --restart always \
  --network host \
  -v /volume1/app/dsh-relay/state:/data \
  dsh-connector
```

注意：必须 `--network host`（要访问内网 3081 端口的网关）；`/data` 卷保存身份与凭据，**删除即重新配对**。

### 4.4 若网关不在同一容器/网络

`--gateway` 可以指向任何可达地址，例如网关跑在另一个 docker 里：
`--gateway ws://<容器名或内网IP>:3081/ws/mobile`。

## 5. 小程序配对（部署完成后）

1. 取当前配对载荷（connector 每次连接成功都会打印；也可重跑 `node agent-connector.js --relay ... --gateway ...` 查看，不会重复生成身份）：
   ```bash
   grep -A1 "=====" /volume1/app/dsh-relay/connector.log | tail -1
   ```
2. 把这段 Base64URL 字符串做成二维码（任意在线生成器），或直接复制；
3. 微信小程序 dsh-weapp → 设备配对 → 扫码，或粘贴到「手动配对」；
4. 小程序显示「配对成功」即完成。之后小程序重启、fnOS 重启都自动重连，无需再扫码。

## 6. 验证清单（AI 执行后逐项确认）

- [ ] `node -v` ≥ 18
- [ ] `curl -si http://192.168.x.x:3081/ws/mobile | head -1` 有响应（网关在线）
- [ ] connector 进程在运行：`pgrep -f agent-connector.js`
- [ ] 日志出现「已注册到中继」且无持续重连报错
- [ ] `~/.dsh-weapp-relay/identity.json` 存在
- [ ] 小程序扫码后显示「配对成功」，首页出现工作区/会话列表
- [ ] 小程序杀掉重开，10 秒内自动重连（观察 connector 日志出现新的「管道 ... 拨本地网关」）

## 7. 常见故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 日志反复「与中继断开，准备重连」 | VPS 中继没起来 / 域名不通 / 证书无效 | 在 fnOS 上 `curl -sI https://<中继域名>`；去 VPS 查 `systemctl status dsh-relay` 和 nginx |
| 「拨本地网关 … ECONNREFUSED」 | dsh-plugin-weapp-gateway 没运行或端口不对 | 确认网关监听端口，修改 `--gateway` 参数 |
| 小程序报「E2EE 握手失败：agent 身份验签未通过」 | 配对载荷与当前 identity.json 不匹配（换过身份） | 在 fnOS 重新取最新配对载荷，小程序删除旧主机后重新扫码 |
| 小程序报「E2EE 解密失败」 | 中继串线或重放 | 重进小程序即可；持续出现则重启 connector |
| 配对成功但列表为空 | 网关侧未启用/无工作区 | 检查 dsh-plugin-weapp-gateway 的 WebUI 配置 |
| 改了 `--gateway` 后连不上 | token 按网关地址区分存储 | 删除 `~/.dsh-weapp-relay/credentials.json` 中对应条目（或整个文件）后重新扫码 |

## 8. 安全说明

- `identity.json`（私钥）与 `credentials.json`（网关 token）都在 `~/.dsh-weapp-relay/`，权限 0600，请勿外传；
- 中继（VPS）只能看到加密流量与 nodeId，无法解密会话内容；
- 载荷二维码长期有效（含公钥，不含私钥），泄露他人也只能「连不上你的 fnOS」而无法解密——但建议不要公开传播；
- 若怀疑泄露：删除 `identity.json` 并重启 connector（生成新身份），小程序重新扫码即可。

---

*文档对应代码版本：2026-09-23（e2e-test.mjs 13 项测试全部通过的版本）。*
