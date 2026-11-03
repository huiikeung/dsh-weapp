# native-core（原生共享核心 HAR）

主题 / 偏好存储 / 全局状态 / 网关 WebSocket 客户端的单一实现，被
`../native-atomic`（元服务）与 `../native-app`（应用）共同依赖。

- 对外出口：根目录 `Index.ets`
- 构建方式与整体架构：见 [../NATIVE.md](../NATIVE.md)
- 仅被两个壳引用，不单独运行；不要在这里写页面（页面属于各自壳的 `entry/.../pages`）。
