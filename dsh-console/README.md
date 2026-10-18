# 鲸尾公网服务端

后台、部署脚本和公网中继统一放在本目录，与仓库根目录的小程序代码分开。

```text
dsh-console/
├── deploy/                 # 一键安装、升级、备份恢复、统一 Docker Compose
├── services/public-access/ # 网页管理后台、微信身份、兑换码、分享活动 API
└── relay/                  # 公网中继与 DSH 插件连接器
```

## 上传到宝塔服务器

将本地 **dsh-console 文件夹里面的内容**上传到 `/www/wwwroot/dsh-console/`。上传后应直接存在：

```text
/www/wwwroot/dsh-console/
├── README.md
├── deploy/
├── services/public-access/
└── relay/
```

**不要再嵌套一层 dsh-console，也不要上传整个小程序仓库。** 不上传本机 `.env`、`node_modules/`、运行数据（`data/`、`relay-state.json`）、日志或备份。上传源代码时保留服务器原来的 `deploy/.env` 和数据；不要使用会删除服务器额外文件的镜像同步。

### 已经部署：直接升级

```bash
cd /www/wwwroot/dsh-console/deploy
bash upgrade.sh
```

本次只是整理本地源码目录，服务器已有目录、域名、宝塔反代和 Docker 数据卷不变，不需要重新部署或初始化。仅为目录整理，无需重启服务器；需要上线其他功能更新时，再上传并执行升级。

### 首次安装：宝塔模式

```bash
cd /www/wwwroot/dsh-console/deploy
bash install.sh --baota
```

宝塔反向代理仍指向 `http://127.0.0.1:18080`，由宝塔管理公网 80/443 和 SSL。完整步骤、初始密钥说明、备份迁移及插件更新见 [部署教程](deploy/README.md)。不要重复部署三套独立服务。

## 本地回归测试

在整个小程序仓库根目录执行（跨端测试还需要根目录 `utils/`；不属于服务器运行依赖）：

```bash
node --test --test-reporter=spec tests/*.test.js dsh-console/services/public-access/test/*.test.cjs dsh-console/relay/public-access.test.cjs
```
