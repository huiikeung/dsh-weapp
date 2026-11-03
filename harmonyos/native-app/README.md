# 鲸尾 Harness 原生应用壳（native-app）

本目录是**原生应用**壳（`bundleType: app`），与 `../native-atomic`（原生元服务，优先）
共用 `../native-core` 的核心代码。

- 架构、构建命令、迁移路线：见 [../NATIVE.md](../NATIVE.md)
- 本壳职责：承载应用侧专属能力（服务卡片、实况窗、通知、后台保活、多设备布局）
- 构建：
  ```sh
  cd harmonyos/native-app
  /Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm install --all
  /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw --mode module -p product=default assembleHap --no-daemon
  ```
