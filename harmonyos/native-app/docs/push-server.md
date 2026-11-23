# Push Kit 服务端接入说明（配套 PushService.ets）

客户端（`entry/src/main/ets/services/PushService.ets`）已实现：启动时 `pushService.getToken()`，并通过 WebSocket 上报 `{"type":"push-token","platform":"harmonyos","token":...}` 帧。要真正打通「App 后台/被杀也能收到主机指令」，还需要以下三步。

## 1. AGC 控制台（人工操作，无代码替代）

1. [AppGallery Connect](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html) 建项目、添加应用（包名 `com.flukit.app`）；
2. 开通「推送服务」；
3. 生成**服务端**凭据：OAuth 2.0 Client ID + Client Secret（或项目服务账号密钥 JSON）；
4. 打包签名必须使用与该 AGC 应用关联的证书（Project Structure → Signing Configs 勾选自动签名即可关联）。

未完成前，客户端 `getToken()` 会失败并静默降级——不影响其他功能。

## 2. 网关/中继侧（dsh-console relay 或 mobile-gateway 插件）

- 接收并存储 `push-token` 帧：`deviceId → pushToken` 映射（内存或 state 文件均可）；
- 下发指令（device-tool 帧）前判断该设备 WebSocket 是否在线：
  - 在线 → 照常走 WebSocket；
  - 不在线 → 调华为推送 REST 把**唤醒通知**发到该 token。

## 3. 推送发送示例（服务端 REST）

```
POST https://push-api.cloud.huawei.com/v1/{appId}/messages:send
Authorization: Bearer {OAuth access token}
Content-Type: application/json

{
  "token": ["<pushToken>"],
  "payload": {
    "data": "{\"type\":\"wake\",\"reason\":\"device-tool\"}"
  }
}
```

`data` 消息（无通知栏、静默）：鸿蒙端收到后进入 `onNewWant`/推送点击回调，**自动重连网关 → 重连后 DeviceConnectors.onConnected() 会补注册 → 主机把排队的 device-tool 帧补发**。客户端不需要解析复杂指令，"唤醒+重连"就够——指令本体仍走 WebSocket，避免经由第三方通道传输敏感内容。

## 4. 已知边界

- 静默 `data` 推送华为侧有频控（应用每天每设备有限额）；主机侧应合并短时间内的多条指令，只在第一条时唤醒。
- 用户强杀 + 系统深度休眠时推送可达性仍高于 WebSocket，但不保证 100%；前台场景永远走 WebSocket 直连。
