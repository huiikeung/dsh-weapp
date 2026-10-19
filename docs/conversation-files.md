# 会话文件显示与底部避让

## 文件来源

- `deliverables/presented`：显示 DSH 明确交付的文件、原始说明和预览菜单。
- 成功的 `write`、`edit`、`str_replace_editor`：保留这一轮实际编辑的文件；失败、只读调用、替换型结果和正文中的路径不生成卡片。
- `workspace/changes`：查询 Host 对应会话及事件序号的变更快照，显示完整文件清单、增加/删除行数；点击文件查看真实差异。
- 相邻交付卡片与已编辑卡片之间统一留出 20rpx。浅色与深色复用现有主题。

变更快照由 DSH 的 `workspaceChanges` 服务管理，旧快照可能随主机会话释放而失效。失效时保留已确认的文件列表并说明状态，不伪造行数。未支持新接口的网关仍能显示交付文件和成功编辑的文件；完整摘要提示更新网关。

## 网关桥接

只增加已配对设备可访问的只读 `workspace-changes-summary` 和 `workspace-changes-diff` 请求，沿用已有 WS/WSS/中继传输，不更改公网域名、配对身份或授权。Host 服务可用时 hello 宣告 `workspace-changes-v1`；没有服务的旧 Host 保留其他网关功能。

```sh
node scripts/install-workspace-changes-bridge.cjs /absolute/gateway/package --check
node scripts/install-workspace-changes-bridge.cjs /absolute/gateway/package
```

安装前自动备份被修改文件，重复执行不会重复插入。对实际启用的插件目录安装；有 local-plugins 源目录时也应同步。等待当前 DSH 任务完成后正常重启 DSH，再重新连接小程序，新的能力声明才会生效。不要为加载补丁强制终止运行中的任务。

本次本机安装目录为 desktop profile 的 node_modules 与 local-plugins 下的 dsh-plugin-weapp-gateway；只写入补丁，未重启运行中的 DSH。网关语法与模拟接口测试通过，真实摘要/差异连接仍待重启后验证。

## 底部布局

避让占位放入 scroll-view 的实际内容里，位于最后一条内容之后、滚动锚点之前。按滚动视口底部与输入栈顶部的实际重叠量测量，包括安全区、键盘和运行中的鲸尾状态。仅用户保持在底部时跟随高度变化，阅读历史内容时不强制跳转。

## 检查

```sh
node --test tests/workspace-changes.test.js tests/session-dock-clearance.test.js tests/file-deliverables.test.js
```

WXML 编译测试可通过 `WECHAT_WCC` 指向微信开发者工具中的 wcc。自动化测试不替代手机的滚动、键盘和文件预览验收。
