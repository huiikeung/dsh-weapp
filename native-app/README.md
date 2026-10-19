# Android / iOS 多端配置

原仓库根目录的 `project.miniapp.json`、`app.miniapp.json`、`miniapp/android` 和 `miniapp/ios` 已迁入本目录。微信小程序项目不再开启 `projectArchitecture: multiPlatform`，不会上传这些原生配置。

从仓库根目录运行 `node scripts/prepare-native-app.cjs`，生成 `native-app/generated-miniprogram/`，再用多端工具打开这个生成目录。它从 `miniprogram/` 同步业务代码，并单独启用多端配置。不要直接修改生成目录，业务代码在 `miniprogram/` 修改，原生配置在本目录修改。

鸿蒙原生 Application 工程继续使用独立 `../harmonyos/`，控制台继续使用 `../dsh-console/`，部署路径不变。
