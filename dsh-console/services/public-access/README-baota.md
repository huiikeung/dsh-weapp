# 鲸尾后台：宝塔面板搭建步骤

本次设备 ID 管理员绑定、兑换码复制/删除、分享活动配置与验收见 [统一部署教程](../../deploy/README.md#本次更新管理员设备-id兑换码与分享活动)。完整上传需要包含 engagement.cjs；分享活动默认暂停，由网页确认平台规则后启用。若使用手动 Nginx 配置，两个 /share/moments/start、/share/moments/submit 上传接口须允许 470000 字节请求体，其余保持原限制。自动 Compose 反代已更新，外层宝塔上传限制也不能更小。

**已用统一部署且源码在 /www/wwwroot/dsh-console：将本地 dsh-console/ 里面的内容上传到该目录，不要再嵌套一层 dsh-console。保留原 deploy/.env，不上传本机 .env、node_modules、data、relay-state.json、日志或备份，然后执行下面两行，不重新安装。**

~~~bash
cd /www/wwwroot/dsh-console/deploy
bash upgrade.sh
~~~

升级保留宝塔反代 127.0.0.1:18080、管理员、兑换记录和设备身份；详细备份、兼容插件更新、小程序重新发布步骤见 [统一部署教程](../../deploy/README.md)。本次新兑换码只管账号公网时长，用户扫描自己的插件二维码，局域网和直接连接不受影响。普通用户无需配置 connector.json、添加托管节点或填写外部授权接口。

这份只讲 Linux 宝塔：**宝塔安装 Node → 上传程序 → 配置密钥 → 添加 Node 项目 → 绑定域名/SSL → 初始化后台**。不使用 Docker，不另装系统 Nginx，不另建 systemd/手动 PM2 进程。

如果是**首次安装** Docker 一键整合方案，完整代码请上传到 `/www/wwwroot/dsh-console`，然后在宝塔终端执行：

```bash
cd /www/wwwroot/dsh-console/deploy
chmod +x install.sh migrate.sh
./install.sh --baota
```

一键方案会同时启动管理后台、relay 和内部反向代理，宝塔继续负责公网 80/443、域名和 SSL。宝塔网站的反向代理目标填写 `http://127.0.0.1:18080`，代理目录 `/`，发送域名使用当前站点域名，关闭代理缓存并开启 WebSocket；不要让静态 root/try_files 规则截走 `/console/*` 或 `/relay/*`。下面的宝塔 Node 项目方案适用于不使用 Docker 的情况，二选一，不要重复启动同一套服务。

适用于已安装宝塔、可使用「网站 → Node 项目」且已安装 Nginx 的服务器。不同版本可能叫「NodeJS项目」「启动选项」「外网映射」，按字段含义填写；若面板不支持下面的 npm 脚本启动，不要把参数拼进“启动文件”字段，先确认面板界面。不要用 PHP 项目直接公开本程序目录。

本文示例域名 console.example.com，换成你的域名。已有相同程序部署时先停止并备份旧实例，再迁移，不能启动两个实例共写数据。

## 1. 在宝塔安装环境

1. 宝塔 → 软件商店：确认 Nginx 已安装并运行；本项目不需要 MySQL、PHP、Redis。
2. 搜索安装「Node.js 版本管理器」，在版本列表安装一个 22.x 版本。不要卸载其他项目使用的 Node。
3. 记下安装路径，通常为 /www/server/nodejs/v22.具体版本/。本项目要求 Node 22 或以上，此教程统一用 22.x。
4. 域名 A 记录指向服务器公网 IP。云安全组和宝塔防火墙放行 TCP 80/443；**不要向公网放行 8790**，不要改动现有 SSH/面板访问规则。

## 2. 上传后台代码

仅单独部署后台时，在宝塔「文件」创建 /www/apps/dsh-console，将本机 dsh-console/services/public-access **里面的内容**上传进去。上传后应直接存在：

~~~text
/www/apps/dsh-console/server.cjs
/www/apps/dsh-console/console.cjs
/www/apps/dsh-console/durations.cjs
/www/apps/dsh-console/package.json
/www/apps/dsh-console/package-lock.json
/www/apps/dsh-console/web/index.html
~~~

connector.cjs、gateway 文件夹和说明文件也保留，后面电脑端接入会用到。不要上传本机 node_modules、真实 .env、data；不要形成多套嵌套 public-access/public-access 目录，也不要只传 web。

后端代码目录不作为静态网站根目录。后面创建的是 Node 反代站点，浏览器只能通过应用接口取页面。

## 3. 宝塔终端安装依赖

宝塔左侧「终端」，以下以 root 管理终端为例；非 root 账号需相应 sudo 权限。将路径中的“替换为实际v22版本”改成第 1 步看到的完整目录名，例如格式 v22.x.y，不能原样复制占位符：

~~~bash
export PATH="/www/server/nodejs/替换为实际v22版本/bin:$PATH"
node -v
npm -v
cd /www/apps/dsh-console
npm ci --omit=dev
~~~

确认 node -v 输出 v22.x。如果找不到 node，修正实际路径，不要再 apt/yum 安装另一套 Node。这里无需 npm run build，网页和服务已经是可运行源码。

## 4. 创建私有配置与数据目录

还是在宝塔终端执行，先确认 www 用户存在：

~~~bash
id www
install -d -m 0750 -o root -g www /www/server/dsh-console-private
install -d -m 0700 -o www -g www /www/server/dsh-console-private/data
openssl rand -hex 32
openssl rand -hex 32
~~~

若 www 不存在先停止，检查宝塔运行账号，不要忽略报错。两次随机输出分别保存，不能使用同一个串、不能发到聊天或截图。

在宝塔「文件」进入 /www/server/dsh-console-private，新建 console.env，用编辑器填写：

~~~dotenv
NODE_ENV=production
CONSOLE_ORIGIN=https://console.example.com
ACCESS_MASTER_KEY=第一次生成的64位十六进制随机串
CONSOLE_SETUP_TOKEN=第二次生成的64位十六进制随机串
ACCESS_HOST=127.0.0.1
ACCESS_PORT=8790
ACCESS_STATE_FILE=/www/server/dsh-console-private/data/state.json
~~~

把域名和两个随机串换成真实值。域名地址不能带尾部斜杠或其他路径。AppID/AppSecret 先不用填，稍后在网页设置。**ACCESS_MASTER_KEY 以后升级不可重新生成。**

保存后在终端设置权限：

~~~bash
chown root:www /www/server/dsh-console-private/console.env
chmod 640 /www/server/dsh-console-private/console.env
~~~

本文使用宝塔常见运行账号 www；同服务器其他以 www 运行的程序也属于同一权限边界。若服务器托管不可信程序，应使用独立 Linux 服务账号，并同步调整项目运行用户及以上目录归属，不能把共享 www 账号当成租户隔离。

## 5. 添加宝塔启动脚本

在第 3 步同一个终端（Node PATH 仍有效）执行：

~~~bash
cd /www/apps/dsh-console
npm pkg set 'scripts.start:baota=node --env-file=/www/server/dsh-console-private/console.env server.cjs'
node -p 'require("./package.json").scripts["start:baota"]'
~~~

预期显示 node --env-file=... server.cjs。脚本只在部署目录增加一个 npm 命令，不改变原 start，也不把密钥写进 package.json。**不能直接选原 start**，它不会替你加载这里的私有配置。

确认程序目录内没有真实秘密/运行数据后，再设置代码只读权限。路径只限本项目目录，不能改成 /www 或其他业务目录：

~~~bash
chown -R root:www /www/apps/dsh-console
chmod -R u=rwX,g=rX,o= /www/apps/dsh-console
~~~

若 Node 启动器要求日志文件可写，在面板把日志路径指向单独日志目录并只授予该目录写权限；不要为了启动方便把整个代码目录设为 777。

## 6. 网站 → Node 项目 → 添加项目

按下面填写，提交前确认工作目录与 Node 版本正确：

| 字段 | 填写 |
| --- | --- |
| 项目名称 | dsh-console |
| 项目路径 / 运行目录 | /www/apps/dsh-console |
| Node 版本 | 第 1 步安装的 22.x |
| 包管理器 | npm |
| 启动选项 / npm 脚本 | start:baota（执行 npm run start:baota） |
| 项目端口 | 8790 |
| 运行用户 | www |
| 实例数 / 集群数 | 1，单进程；不要开 cluster 多实例 |
| 开机启动 | 开启 |
| 文件变化自动重载 / watch | 关闭 |
| 域名 | console.example.com；若此处没有，则在项目设置绑定 |

如果界面只提供自定义完整命令，填写：

~~~bash
npm run start:baota
~~~

这仍需在 /www/apps/dsh-console 工作目录、所选 Node 22 环境执行。不要把整条命令填进只接受文件路径的“启动文件”输入框。不要再用终端 npm start、systemd、另一个 PM2 项目同时启动它。

提交后看 Node 项目日志；应出现 Public access service listening; secrets are not logged。然后在宝塔终端验证：

~~~bash
curl -fsS http://127.0.0.1:8790/health
ss -lntp '( sport = :8790 )'
~~~

预期返回 {"ok":true}，端口监听 127.0.0.1:8790。失败先修项目日志，不能继续靠配置域名解决 Node 启动错误。

## 7. 项目设置：绑定域名与外网映射

1. 在 dsh-console 的设置中绑定 console.example.com。
2. 开启「外网映射 / 域名映射」，让 Nginx 转发到 **http://127.0.0.1:8790**。这里是 Nginx 对外提供 80/443，不是向公网开放 8790。
3. 若同域名已有网站，不要再创建重复站点或第二套映射；选用现有站点的反向代理，目标仍为 127.0.0.1:8790，代理目录 /，缓存关闭。
4. 核对读取/发送超时至少 35 秒，防止生成配对码等待电脑回传时被截断。必要时在该站点现有反代配置修改如下项，不重复新增 location /：

~~~nginx
proxy_read_timeout 35s;
proxy_send_timeout 35s;
~~~

不要重写 Origin，不要给后台 API 开缓存，也不要添加 SPA 的 try_files 回退。如果页面白屏，检查 /console/app.js、/console/style.css 是否被面板静态资源规则截走，它们也必须转发到 Node。此管理站点不承载 WSS 数据通道，无需把中继 WebSocket 搬到这里。

## 8. SSL → 申请证书 → 强制 HTTPS

在该域名站点/Node 项目映射设置的「SSL」中申请受信任证书，例如 Let's Encrypt。确认 DNS 已生效、80/443 可访问，申请成功并部署后开启强制 HTTPS，确认自动续签启用。

宝塔终端检查（域名替换成你的）：

~~~bash
curl -fsS https://console.example.com/health
curl -fsS -o /dev/null -w '%{http_code}' https://console.example.com/
~~~

分别应返回 {"ok":true} 和 200。不要加 -k 绕过证书错误，不用首页 HEAD 请求判断页面能否用。

## 9. 打开网页并设置小程序

1. 浏览器打开你的 HTTPS 域名，看到「初始化管理台」。
2. 如果使用 `/www/wwwroot/dsh-console/deploy` 的 Docker 一键方案，在宝塔终端执行 `cd /www/wwwroot/dsh-console/deploy && grep '^CONSOLE_SETUP_TOKEN=' .env`，把等号后面的完整内容填入「初始密钥」。不要把 `ACCESS_MASTER_KEY` 当作初始密钥，也不要把密钥发到聊天或日志。
3. 设置至少 12 字符的管理密码。初始化成功后，后续使用管理密码登录。
4. 后台「微信与管理员」填写当前小程序 AppID/AppSecret。
5. 微信后台 request 合法域名加入此 HTTPS 域名。小程序 utils/access-config.js 的 baseUrl 填该地址后重新编译；不能填秘密密钥。
6. 网页生成管理员身份绑定码，本人小程序设置中提交，回到网页核对批准。批准后小程序设置显示「生成配对码」。

注意：本文独立 Node 方案只部署管理后台，不包含中继鉴权。正常公网服务推荐统一 deploy 方案。用户连接自己的 DSH 只需兼容插件、账号兑换和插件扫码；README-deploy.md 第三节的限时网关扩展、后台节点及 connector.cjs 仅属于可选托管设备功能，与新公网兑换码无关。

## 10. 重启、升级、备份与常见错误

- 改 console.env 后：宝塔 Node 项目 → 重启。配置与网页访问域名保持一致，不改主密钥。
- 升级前：面板停止该 Node 项目，将 /www/server/dsh-console-private 整个目录（包含配置和 data）加密备份到非公开位置；确认备份后恢复运行。普通“网站备份”可能不包含这个目录，需要单独配置备份。
- 升级时：停止项目，只更新代码，不覆盖私有目录；在 Node 22 终端重新 npm ci --omit=dev，再执行第 5 步 npm pkg set 以保留 start:baota，核对代码权限后在面板启动。
- 重启服务器后确认项目自动启动、原管理员/节点数据仍在。服务只允许一个写入实例，不用多进程扩容。
- Set CONSOLE_ORIGIN：通常选成了原 start，改用 start:baota，并检查配置文件路径。
- ENOENT / EACCES：检查 console.env 是否存在、www 是否能读配置/写 data；不要 chmod 777。
- Cannot find module qrcode：在正确目录、正确 Node 环境重新 npm ci --omit=dev。
- EADDRINUSE：8790 被旧进程占用，先识别旧服务，不能盲目 kill 其他业务或随便多起一份。
- 502：先在服务器本机 curl /health，Node 正常再检查 Nginx 反代地址；不要把 ACCESS_HOST 改成公网监听绕过问题。
- CSRF / ORIGIN：确认访问的是配置中的 HTTPS 域名，没有伪造 Origin 请求头，重启后重新登录。

这是面板部署步骤，尚未在你的服务器实际执行。公网推广前还需按业务配置登录限流、监控和备份；默认能打开页面不等于已完成生产安全验收。

## 宝塔官方参考

- Node.js 版本管理器： https://www.bt.cn/bbs/thread-75284-1-1.html
- Node 项目创建/运行字段： https://docs.bt.cn/ai-ops/mcp/tools-reference/
- Node 项目与域名映射操作： https://docs.bt.cn/practical-tutorials/nextjs-deployment/ （只参考面板操作，本项目不是 Next.js，无需 build）
- 站点与 SSL： https://docs.bt.cn/landing/getting-started/
