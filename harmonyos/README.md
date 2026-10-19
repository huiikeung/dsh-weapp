# harmonyos — 鸿蒙应用（Application）工程目录

用于存放 dsh 业务的鸿蒙原生应用代码，与现有微信小程序（`../miniprogram/`）相互独立，互不影响。

> 注：已确认做**普通鸿蒙应用**，不做元服务（Atomic Service），即 `bundleType` 保持默认 `"app"`，无 10MB 包体限制，走应用市场正常安装分发。

## 使用方式

不要手写整个工程结构，推荐用 DevEco Studio 在此目录下创建：

1. 打开 DevEco Studio → File → New → New Project
2. 位置选择本目录（`dsh-weapp/harmonyos`），模板选 **Application → Empty Ability**
3. DevEco 会自动生成 `AppScope/`、`entry/` 等标准工程结构

## 目录约定

- `entry/src/main/ets/pages/` — 页面（ArkTS）
- `entry/src/main/module.json5` — 模块配置（权限、Ability 入口等）
- `AppScope/app.json5` — 应用级配置（签名、图标、bundleName）

## 当前进度（2026-09-24）

- [x] 阶段 1：hvigor 工程骨架、DSH 主题色板（对齐 Theme.swift）、深海动画背景、四页 Tabs 导航
- [x] 阶段 2a：GatewayFrame/DTO 全量 ArkTS 定义 + 宽松解码器（对齐 GatewayDtos.kt），Node 冒烟测试通过
- [ ] 阶段 2b：WebSocket 客户端（@ohos.net.webSocket）、配对握手、重连、多主机管理
- [ ] 阶段 3：MVI Store（SessionList/SessionControl/Question/Approval reducer）
- [ ] 阶段 4：会话主界面（ConversationProjection、流式渲染、审批/问答 UI）
- [ ] 阶段 5：Trajectory + History + Workspace
- [ ] 阶段 6：长时任务、卡片、设置页、本地化

用 DevEco Studio 打开 `harmonyos/` 目录即可构建（API 12+）。协议解码冒烟测试：`node entry/src/test/GatewayFrameCodec.test.mjs`。
