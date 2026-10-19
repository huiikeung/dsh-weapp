# 微信小程序

微信开发者工具请直接导入当前 `miniprogram/` 文件夹。此目录只包含小程序运行文件，控制台、鸿蒙、Android/iOS、测试、文档及原始素材均在外部，不会进入上传包。

已有的仓库根目录工程仍通过 `miniprogramRoot: miniprogram/` 指向此目录。迁移后请关闭旧项目，再导入当前目录，避免旧文件缓存。不要开启“忽略上传大小限制”代替体积治理。

从仓库根目录执行：

```powershell
node scripts/check-miniprogram-package.cjs
node scripts/stamp-build.cjs
node --test tests/miniprogram-layout.test.js
```

语言字典源文件在 `../resources/i18n/`；修改后运行 `node scripts/sync-i18n.cjs`。运行时仍使用 JS 模块，避免 JSON require 导致启动空白。

主包和各分包原始源码预算为 1.8 MiB，预留编译/封装余量。该检查不等同于微信服务器实际上传大小，实际预览需在开发者工具中完成。
