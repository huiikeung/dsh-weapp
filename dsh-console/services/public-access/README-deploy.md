# 鲸尾网页管理台 · 部署指南

**最简单的方式是使用仓库内 [Docker 一键部署包](../../deploy/README.md)：它会同时启动管理后台、relay 和 HTTPS，换服务器可直接备份恢复。使用宝塔面板请看 [宝塔专用搭建步骤](README-baota.md)。**

**普通用户公网服务请使用仓库 dsh-console/deploy 教程，将本地 dsh-console/ 里面的 deploy、services、relay 上传到服务器 /www/wwwroot/dsh-console/，不要再嵌套同名目录。已部署时保留 deploy/.env，执行 cd /www/wwwroot/dsh-console/deploy 后运行 bash upgrade.sh。** 不上传本机 .env、node_modules、data、relay-state.json、日志或备份。该升级保留数据、管理员、兑换记录和宝塔端口；另需更新小程序及插件安全连接器，具体见统一教程。

本文后续方案 A/B 是「单独部署管理后台」与旧托管节点方案，不是普通用户开通公网的必做步骤。仅上传 services/public-access 只能提供网页/API，不能升级 relay 的账号校验。

后台运行在服务器，电脑和手机浏览器都访问同一个 HTTPS 地址。桌面采用侧栏导航、全宽工作区及双栏签发/记录面板；小屏自动单栏，支持明暗主题。DSH 电脑只运行连接器与网关，不承载管理网页。

正常使用顺序：统一部署/升级 → 微信管理员绑定 → 生成账号公网兑换码 → 用户兑换 → 扫自己插件二维码。无需给普通用户配置 connector.json 或外部授权接口。仅需托管设备限时配对时再阅读本文第三节；它与公网服务有效期独立，切勿混用。

## 功能

- 首次初始化、密码登录、改密、退出；不是首个访问者自动成为管理员。
- 网页配置小程序 AppID / AppSecret，密钥加密保存且不回显。
- 管理员身份绑定码：小程序提交真实微信身份，网页核对批准后自动识别；也支持输入已核实的 OpenID。
- 添加/停用/重置电脑端连接器，查看节点心跳和连接数。
- 网页与小程序设置「生成配对码」共同签发 3 天、7 天、30 天、半年（180 天）、1 年（365 天）的设备访问授权，使用同一节点列表、期限选项与签发/停用记录。
- 向在线 DSH 请求真实的一次性设备配对码，网页显示二维码及可复制文本，小程序显示可复制文本，兼容扫码/手动配对。
- 网页和小程序共同生成 3/7/30/180/365 天的账号公网兑换码，管理使用次数及停用；无需外部授权接口。公网到期不影响局域网、直接连接或自建中继。

三个码不同：身份绑定码（WB-）用于管理员身份；设备配对码用于连接 DSH；兑换码用于公网授权续期。

## 一、服务器部署：先选一种方案

Docker 也是部署在服务器上，不是只能在本地电脑运行。以下两种方案任选其一，**不要同时部署到同一个域名，也不要同时争用 80/443 端口**。

| 场景 | 选择 | HTTPS | 数据位置 |
| --- | --- | --- | --- |
| 新服务器，没有网站面板 | A：Docker Compose + Caddy | Caddy 自动管理证书 | Docker 命名卷 |
| 已有 Nginx / 宝塔，或不用 Docker | B：Node.js + systemd + Nginx | Certbot 或宝塔 SSL | /var/lib/dsh-console |

以下服务器命令以 **Ubuntu 24.04 LTS、Bash、有 sudo 权限的 SSH 账号**为例。其他发行版的包管理、Nginx 目录可能不同，不要直接照搬。示例域名 console.example.com、服务器 IP、账号 ubuntu 均须换成你自己的值。配置正文需要粘贴进编辑器，不能当成 shell 命令执行。

### 0.1 域名、网络与端口

1. 为域名添加 A 记录，指向服务器公网 IPv4。设置了 AAAA 时，IPv6 也须正确连到本服务器，否则修正记录。
2. 云安全组开放入站 TCP 80、443；SSH 端口只允许你的管理 IP。**不要开放公网 8790，也不要开放 DSH 电脑管理端口。**
3. 服务器需能出站访问 HTTPS，用于安装依赖、申请证书与微信身份验证。电脑连接器需能通过 HTTPS 访问此域名。系统时间必须正确。
4. 初次验收尽量使用直连域名，避免额外 CDN 缓存/来源配置干扰；已有业务的 CDN 不要未经评估随意关闭。
5. 本后台使用独立域名的根路径，不要直接改成 /dsh 子路径。源码、.env、data 不能设为公开网站目录。

在服务器检查：

~~~bash
cat /etc/os-release
uname -m
timedatectl status
getent ahosts console.example.com
sudo ss -lntp '( sport = :80 or sport = :443 or sport = :8790 )'
~~~

已有 Nginx/宝塔占用 80/443 时选择方案 B，不要停止其他网站来腾端口。已启用 UFW 的服务器也要放行 80/443，但修改防火墙前先确认当前 SSH 端口已放行，**不要盲目执行 ufw enable**。云安全组与系统防火墙分别检查。

### 0.2 上传程序（两套方案共用）

仅单独部署后台时，上传项目里的 dsh-console/services/public-access，不是整个小程序，也不是只上传 web。本地代码可能尚未推送 GitHub，下面直接打包当前版本；明确列出的文件不包含真实 .env、运行数据和 node_modules。

**在你的 Mac 终端执行：**

~~~bash
cd /Users/0the/Downloads/dsh-weapp/dsh-console/services/public-access
tar -czf /tmp/dsh-console-code.tar.gz server.cjs console.cjs connector.cjs durations.cjs engagement.cjs announcements.cjs package.json package-lock.json web gateway test Dockerfile compose.yaml Caddyfile .dockerignore .env.example README.md README-deploy.md README-baota.md connector.example.json
scp /tmp/dsh-console-code.tar.gz ubuntu@你的服务器IP:/tmp/dsh-console-code.tar.gz
ssh ubuntu@你的服务器IP
~~~

**以下在服务器执行，仅限首次安装：**

~~~bash
sudo install -d -m 0755 -o "$(id -un)" -g "$(id -gn)" /opt/dsh-console
tar -xzf /tmp/dsh-console-code.tar.gz -C /opt/dsh-console
cd /opt/dsh-console
ls server.cjs console.cjs durations.cjs package-lock.json compose.yaml web/index.html
~~~

已有部署请先看后面的升级/备份章节，不能重新初始化或生成新主密钥。

## 方案 A：Docker Compose + Caddy

### A1. 安装 Docker 与 Compose

先检查；已有 Docker 且 Compose 可用，直接跳到 A2。**不要卸载承载其他业务的 Docker/containerd。**

~~~bash
sudo docker version
sudo docker compose version
~~~

命令不存在时，在 Ubuntu 24.04 安装官方 APT 仓库：

~~~bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl openssl nano
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
dpkg --print-architecture
sudoedit /etc/apt/sources.list.d/docker.sources
~~~

保存以下正文。Architectures 按刚才输出选择 amd64 或 arm64；noble 只适用于 Ubuntu 24.04：

~~~text
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
~~~

然后安装、启动：

~~~bash
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
~~~

本文统一使用 sudo docker，不需要把普通用户加入高权限 docker 组。如果包冲突，先核实已有服务依赖，不要盲目卸载。

### A2. 配置域名与密钥

~~~bash
cd /opt/dsh-console
test -f .env || cp .env.example .env
chmod 600 .env
openssl rand -hex 32
openssl rand -hex 32
nano .env
~~~

两次输出分别填入下面两个密钥，不要填中文占位内容，也不要用同一个随机串；仅在私有终端操作，不能截图、发到聊天或提交 Git。

~~~dotenv
CONSOLE_DOMAIN=console.example.com
CONSOLE_ORIGIN=https://console.example.com
ACCESS_MASTER_KEY=第一次生成的64位十六进制随机串
CONSOLE_SETUP_TOKEN=第二次生成的64位十六进制随机串
~~~

- CONSOLE_DOMAIN 只填域名，不加协议。
- CONSOLE_ORIGIN 是完整 HTTPS 源地址，不加尾部斜杠或路径，必须与浏览器实际地址一致。
- Dockerfile 已设置监听和数据目录；**不要加入方案 B 的 127.0.0.1 或 /var/lib/... 设置**，否则容器反代/数据存储可能失败。
- AppID/AppSecret 在网页初始化后配置。ACCESS_MASTER_KEY 后续升级不能重新生成，数据须与主密钥配套备份。

### A3. 构建、启动和检查

~~~bash
cd /opt/dsh-console
sudo docker compose -p dsh-console config --quiet
sudo docker compose -p dsh-console up -d --build
sudo docker compose -p dsh-console ps
sudo docker compose -p dsh-console logs --tail=80 console
sudo docker compose -p dsh-console logs --tail=80 caddy
~~~

预期 console 为 running/healthy，caddy 为 running。首次需要下载镜像、构建并申请证书，失败时分别看日志。不要把不带 --quiet 的 config 输出发给别人，它会展开密钥。

以后始终使用相同的 -p dsh-console，避免项目名变化后使用新空数据卷。**已有旧部署使用其他项目名时，必须沿用旧项目名**，不要为了套本文命令而切换。

### A4. 验证 HTTPS

~~~bash
curl -fsS https://console.example.com/health
curl -fsS -o /dev/null -w '%{http_code}' https://console.example.com/
sudo docker compose -p dsh-console exec -T console node -e "fetch('http://127.0.0.1:8790/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
~~~

健康检查应返回 {"ok":true}。不要加 -k 跳过证书验证。浏览器访问 HTTPS 域名根路径，应显示正常管理页面。

宿主机请求 127.0.0.1:8790 不通在方案 A 是正常的：Compose 没有映射此端口，内部测试使用上面的 exec 命令。外部只公开 Caddy 的 80/443。Caddy 负责证书申请/续签，保留其数据卷和必要网络访问。

默认 Caddyfile 有请求体大小限制，**没有额外逐 IP 限速模块**。公开推广前需由可信的边缘防护/反代限流，或选择方案 B 的 Nginx 限流配置；不要认为默认已经具备所有生产防护。

### A5. 初始化管理页面

1. 打开 HTTPS 域名，看到「初始化管理台」。
2. 输入 .env 的 CONSOLE_SETUP_TOKEN，设置至少 12 字符的强管理密码。
3. 登录后按第二、三节配置微信身份、管理员和电脑节点。
4. 再次访问应显示「欢迎回来」登录页；初始化密钥不能用于重置密码或接管后台。

日常查看与控制：

~~~bash
cd /opt/dsh-console
sudo docker compose -p dsh-console ps
sudo docker compose -p dsh-console logs -f --tail=100 console
# 日志跟踪按 Ctrl+C 退出，不会停止容器
# 临时停止（会影响后台访问）
sudo docker compose -p dsh-console stop
# 恢复
sudo docker compose -p dsh-console start
~~~

**不要执行带 -v 的 compose down，也不要清理本项目数据卷。**

## 方案 B：Node.js + systemd + Nginx / 宝塔

后台只监听 127.0.0.1:8790，Nginx/宝塔负责 HTTPS；不能用 root 长期运行 Node，也不能同时使用手动进程、PM2、systemd 启动多个实例。

### B1. 安装独立 Node.js 22

从 Node 官方站获取 22.x 的 Linux 包及 SHA-256 清单，安装到 /opt/node22，不替换其他应用使用的 Node。**若此目录已存在，先检查其版本，已有可用 22.x 就跳过安装；不要覆盖未知程序。**

~~~bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl xz-utils openssl
node_stage=$(mktemp -d /tmp/dsh-node-install.XXXXXX)
cd "$node_stage"
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64|arm64) node_arch=arm64 ;;
  *) printf '当前架构不适用本示例，请使用 Node 官方安装说明'; exit 1 ;;
esac
curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
node_archive=$(awk -v arch="$node_arch" '$2 ~ ("-linux-" arch "[.]tar[.]xz$") {print $2}' SHASUMS256.txt)
test -n "$node_archive" || exit 1
node_version=$(printf '%s' "$node_archive" | sed 's/^node-//; s/-linux-.*$//')
curl -fsSLO "https://nodejs.org/dist/$node_version/$node_archive"
awk -v name="$node_archive" '$2 == name' SHASUMS256.txt | sha256sum --check --strict -
~~~

只有校验显示 OK 才继续。此步骤校验官方 HTTPS 清单与文件的一致性，不替代独立签名验证。

~~~bash
sudo install -d -m 0755 /opt/node22
sudo tar -xJf "$node_archive" -C /opt/node22 --strip-components=1
/opt/node22/bin/node --version
PATH=/opt/node22/bin:$PATH /opt/node22/bin/npm --version
cd /opt/dsh-console
PATH=/opt/node22/bin:$PATH /opt/node22/bin/npm ci --omit=dev
~~~

确认 Node 输出 v22.x。依赖安装失败先检查网络，不要删除 lockfile、随意换包版本或关闭 TLS 校验。

### B2. 创建服务账号与私有配置

先检查账号，只有不存在才执行 useradd：

~~~bash
id dsh-console
# 仅当上面显示账号不存在时执行下一行
sudo useradd --system --home-dir /var/lib/dsh-console --no-create-home --shell /usr/sbin/nologin dsh-console
sudo install -d -m 0700 -o dsh-console -g dsh-console /var/lib/dsh-console
openssl rand -hex 32
openssl rand -hex 32
sudoedit /etc/dsh-console.env
~~~

保存以下正文，两个密钥替换为刚才分别生成的随机串：

~~~dotenv
NODE_ENV=production
CONSOLE_ORIGIN=https://console.example.com
ACCESS_MASTER_KEY=第一次生成的64位十六进制随机串
CONSOLE_SETUP_TOKEN=第二次生成的64位十六进制随机串
ACCESS_HOST=127.0.0.1
ACCESS_PORT=8790
ACCESS_STATE_FILE=/var/lib/dsh-console/state.json
~~~

设置权限。下列递归操作**仅用于本文专用程序目录**，不能改成根目录或别的业务目录：

执行前确认 /opt/dsh-console 中没有真实 .env 或运行状态；如果有旧部署文件，先按第五节备份并迁移到私有配置/数据路径，不能直接放宽它们的读取权限。

~~~bash
sudo chown root:root /etc/dsh-console.env
sudo chmod 600 /etc/dsh-console.env
sudo chown -R root:root /opt/dsh-console
sudo chmod -R go-w /opt/dsh-console
sudo chmod -R a+rX /opt/dsh-console
~~~

/opt/dsh-console 只能放程序，不能放真实 .env 或运行状态；配置在 /etc/dsh-console.env，数据在 /var/lib/dsh-console。systemd 由 root 读取 EnvironmentFile 后传给服务账号，无需公开密钥文件。若安装目录内已有旧配置或真实数据，先安全迁移，不要直接执行上述递归权限操作。

### B3. 用 systemd 常驻运行

~~~bash
sudoedit /etc/systemd/system/dsh-console.service
~~~

保存以下完整服务配置：

~~~ini
[Unit]
Description=Whale DSH management console
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=dsh-console
Group=dsh-console
WorkingDirectory=/opt/dsh-console
EnvironmentFile=/etc/dsh-console.env
ExecStart=/opt/node22/bin/node /opt/dsh-console/server.cjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/dsh-console

[Install]
WantedBy=multi-user.target
~~~

启动并验证：

~~~bash
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-console
sudo systemctl status dsh-console --no-pager
sudo journalctl -u dsh-console -n 80 --no-pager
curl -fsS http://127.0.0.1:8790/health
sudo ss -lntp '( sport = :8790 )'
~~~

预期 active (running)，健康检查返回 {"ok":true}，8790 只监听 127.0.0.1。此处失败先修服务，再做反代。公网 IP:8790 不通是正确配置，不要为调试把该端口开放出去。

### B4. 配置 Nginx（没有宝塔时）

如果服务器已有宝塔管理的 Nginx，请跳到 B6，**不要再安装第二套 Nginx**。Ubuntu 普通 Nginx 服务器：

~~~bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudoedit /etc/nginx/conf.d/dsh-console-limits.conf
~~~

Ubuntu 默认在 http 块加载 conf.d/*.conf。保存这两行：

~~~nginx
limit_req_zone $binary_remote_addr zone=dsh_console_login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=dsh_wechat_session:10m rate=20r/m;
~~~

创建独立站点：

~~~bash
sudoedit /etc/nginx/sites-available/dsh-console
~~~

保存以下完整 HTTP 站点配置，HTTPS 由下一步加入：

~~~nginx
server {
    listen 80;
    server_name console.example.com;
    client_max_body_size 16k;
    limit_req_status 429;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 35s;
    proxy_send_timeout 35s;

    location = /console/api/login {
        limit_req zone=dsh_console_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:8790;
    }
    location = /console/api/setup {
        limit_req zone=dsh_console_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:8790;
    }
    location = /session {
        limit_req zone=dsh_wechat_session burst=10 nodelay;
        proxy_pass http://127.0.0.1:8790;
    }
    location / {
        proxy_pass http://127.0.0.1:8790;
    }
    location ~ ^/share/moments/(start|submit)$ {
        client_max_body_size 470000;
        proxy_pass http://127.0.0.1:8790;
    }
}
~~~

不要伪造 Origin 请求头，也不要缓存后台 HTML/API。此管理站点不需要 WebSocket Upgrade，小程序 WSS 继续连接原中继。如果配置了 AAAA，需另外正确配置 IPv6 listen 与网络，或暂时不发布该 AAAA。

启用站点，不删除其他业务配置：

~~~bash
sudo ln -s /etc/nginx/sites-available/dsh-console /etc/nginx/sites-enabled/dsh-console
sudo nginx -t
sudo systemctl reload nginx
curl -fsS -H 'Host: console.example.com' http://127.0.0.1/health
~~~

软链接已存在时只核实指向，不要覆盖。nginx -t 失败先修复配置，不能继续 reload。

### B5. 配置 HTTPS、初始化后台

DNS 和外网 80 已生效后执行交互式申请：

~~~bash
sudo certbot --nginx -d console.example.com --redirect
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
systemctl list-timers --all 'certbot*'
curl -fsS https://console.example.com/health
curl -fsS -o /dev/null -w '%{http_code}' https://console.example.com/
~~~

按提示填写运维邮箱并确认协议。确认续签演练成功、自动续签 timer 存在；某些发行版用 cron，应检查其实际续签任务，不要让证书只签一次却没人续期。

外部 /health 应返回 {"ok":true}，首页 GET 应返回 200。此程序未专门实现首页 HEAD，所以不用 curl -I 判断首页是否正常。证书失败不能通过 -k 或关闭小程序域名校验来绕过。

打开 HTTPS 域名，用 /etc/dsh-console.env 中的初始化密钥设置管理密码，然后继续第二、三节。CONSOLE_ORIGIN 必须与实际 HTTPS 域名完全一致。

### B6. 已有宝塔：由宝塔处理反代和 SSL

完成 B1–B3 后，以下代替 B4–B5。面板名称可能因版本稍有不同，原则是独立域名 → HTTPS 反代 → 本机 Node：

1. 网站新增域名 console.example.com，不需要数据库或 PHP；网站根目录不能指向程序或数据目录。
2. 网站设置 → 反向代理，目标 http://127.0.0.1:8790，代理目录 /，发送域名使用站点域名，关闭代理缓存。
3. 若面板生成了匹配 js/css 的静态资源 location，确认 /console/app.js 与 /console/style.css 也会转发到 Node，否则会出现白屏/404。不要添加 SPA 的 try_files 回退。
4. SSL 页面申请并启用受信任证书，开启强制 HTTPS，确认自动续签；保留 HTTP 验证需要的 80 端口。
5. 普通请求体上限 16k，仅 /share/moments/start 和 /share/moments/submit 放宽至 470000 字节（见 B4 配置），反代读写超时 35s，保留真实 Origin，不要改写来源。
6. 按 B4 添加登录/初始化/微信登录逐 IP 限流：limit_req_zone 必须在全局 http 块，limit_req 在对应 location。已有 location / 时编辑它，不能重复粘贴一套 server。每次变更先检查配置再重载。
7. 在服务器执行 B5 的两个 HTTPS curl 验证，再用域名初始化网页。

Node 已由 systemd 托管，不要再在宝塔 Node 项目管理或 PM2 启动同一程序。日志使用 sudo journalctl -u dsh-console -n 100 --no-pager。

### 部署边界

完成本节只代表网页/API 上线，**不代表中继通道已接通**；管理后台不是 WSS 中继服务器。接下来仍需配置微信合法域名、绑定管理员、在每台 DSH 电脑上运行连接器。

AppID/Secret 在网页配置，不必写环境变量。ADMIN_OPENIDS 和 MANAGED_NODE_IDS 仅兼容旧配置，环境变量管理员不能在网页删除。

## 二、绑定小程序管理员

1. 网页「微信与管理员」填入小程序后台的 AppID 与 AppSecret。首次绑定后禁止原地更换 AppID，避免不同小程序身份混用。
2. 管理台 HTTPS 域名加入微信后台 request 合法域名；项目 utils/access-config.js 的 baseUrl 填入此 HTTPS 地址，重新编译小程序。
3. 本人在新版小程序「设置 → 公网访问」复制 WX- 小程序设备 ID，网页「微信与管理员」输入该 ID 及备注并核实确认。不要填电脑节点 UUID。
4. 本人重新进入小程序设置，自动显示「微信身份」及「兑换码管理」；普通用户不显示。管理员设备配对入口已从小程序设置移除，普通扫码连接保留。每次请求由服务器重新校验身份，移除权限后立即拒绝管理请求。
5. 普通用户不会因登录/连接节点而变成管理员。公众平台管理员名单不会自动同步，需要你核实绑定对象；人员变更时网页移除其权限。

绑定码 10 分钟有效、一次提交；必须网页批准才授权，不能凭昵称/微信号匹配。

## 三、旧托管功能：生成限时设备配对码（可选）

**用户兑换公网服务、连接自己的 DSH 时跳过本节。** 本节扩展直接限制设备凭据，作用不同于「只限制公网服务」；不要把它当成新兑换码的前置步骤。普通用户只需统一教程中的安全中继连接器，不需下述限时网关扩展或 connector.json。

服务器不持有电脑端的网关私钥，不能凭空签发有效配对码。每台 DSH 电脑需运行附带的轻量连接器。

1. 确认 dsh-plugin-weapp-gateway 已开启移动网关和中继模式，并能在插件内生成 version 3 中继配对码。沿用已有 wss 中继，本管理台不是新的中继服务器。
2. **先安装限时配对扩展**：将本目录的 gateway 文件夹与 durations.cjs 一起复制到 DSH 电脑，保持相对目录。运行 `node gateway/install.cjs /绝对路径/dsh-plugin-weapp-gateway`。安装器核对插件包名及源码锚点，保存原入口备份，遇到不兼容版本拒绝修改。当前与 0.8.6 的本地插件源码进行兼容验证；不是所有未来版本通用。安装后需等当前会话结束，再由你重启 DSH。安装器不会自行重启，也不会修改已有设备凭据。
3. 网页「节点与配对 → 添加节点」，复制一次性显示的连接器配置，保存到 DSH 电脑的私有 connector.json 文件。
4. gateway 填 DSH WebUI 的本机端口，例如 http://127.0.0.1:50154。不是服务器端口，也不是网关 WebSocket 端口；以 DSH 当前实际 WebUI 地址为准。
5. 将 **connector.cjs 和 durations.cjs 放在同一目录**。Node.js 22+ 运行 `node connector.cjs /绝对路径/connector.json`；无需第三方依赖或 npm install。Linux/macOS 建议 chmod 600 connector.json，用自己的 systemd/launchd 等保持运行。
6. 网页「高级功能 → 限时配对」选择后台节点与访问期限。新版小程序设置不再提供此管理员入口。节点离线或缺少扩展时明确拒绝签发，不生成只有显示日期而无到期控制的码。
7. 小程序扫码或手动粘贴完整配对文本。**扫码/粘贴凭据**仍由原插件控制，通常 5 分钟、一次性；**设备访问期限**从签发时开始，按所选天数持续，到期由电脑网关拒绝新连接并断开已有连接（最长约 1 秒）。两者不可混淆。

### 同步与撤销

- 网页和小程序使用同一服务端持久化记录；可见页面约每 10 秒刷新，亦可手动刷新。节点连接器通常每 2 秒上报，历史按每批 30 条轮转，记录较多时同步需要更久。
- 列表显示签发来源、期限、扫码截止、访问到期及待配对/使用中/到期/停用状态。完整配对内容只在生成时返回，不写管理台状态文件；二维码不保存。
- 两端都可停用限时配对。离线节点先显示「等待设备确认停用」，收到网关确认后才显示「已停用」。单纯删除页面或停用连接器不等于撤销设备。
- 到期校验保存在 DSH 电脑侧，不依赖管理服务器一直在线；重启不会清除已配对设备的到期时间。未使用的短期配对码在 DSH 重启后失效。两端需正确校时。
- 中继模式下扩展强制校验设备凭据，即使原网关关闭了调试认证开关，也不能匿名绕过限时授权。
- 安装扩展前的已有设备保留原行为，不会自动追加期限；需用新限时配对重新授权。相同设备的新限时配对会替换旧授权。
- 管理台仅调用本机固定管理接口：状态、生成配对、限时记录及停用；不支持远程命令、任意 URL 或文件读取。

无需开放电脑管理端口。连接器 token 只显示一次，服务端只存摘要；遗失后在网页重置。停用/重置连接器不会停止 DSH，也不会撤销已有设备。新限时设备可在「限时配对」撤销；旧设备仍在 DSH 网关操作。

配对码仅在等待任务和浏览器结果窗短暂存在，不写状态文件。管理台重启未完成任务失效，重新生成即可。旧中继并发管道限制仍存在，本管理台不改变其协议。

## 四、兑换码与公网时长

网页「兑换码」默认选择「鲸尾公网服务（用户自己的设备）」，可签发 3/7/30/180/365 天、1/5/20 人使用的码；已绑定微信管理员的小程序使用相同数据。用户无需选择后台节点，在设置的公网访问中兑换后扫描自己的插件二维码。

统一部署中的新版 relay 强制校验微信账号公网票据，并在到期时断开活跃连接。只有小程序、relay 和安全插件连接器均升级后才形成完整链路。局域网、直连和自建中继不请求此授权；账号公网到期不改电脑设备权限。

外部 HTTPS 授权接口折叠保留在兼容配置中，仅历史节点绑定码需要；新账号码不需要填写它。历史数据不会自动换成新账号码。管理员当前免兑换；普通账号续期从 max(当前时间, 原有效期) 开始，兑换码本身 30 天有效，每账号每码一次。

## 五、安全与备份

### 5.1 Docker：停写备份

在低峰维护窗口操作，后台会短暂不可用。以下命令在**同一个 Bash SSH 会话**执行，并沿用实际 Compose 项目名。备份含密钥，必须私有保存并加密异地备份，不能直接发给别人。

~~~bash
set -o pipefail
cd /opt/dsh-console
backup_dir="/var/backups/dsh-console/$(date +%Y%m%d-%H%M%S)"
sudo install -d -m 0700 "$backup_dir"
sudo install -m 0600 .env "$backup_dir/console.env"
sudo tar --exclude='./node_modules' --exclude='./data' --exclude='./.env' -czf "$backup_dir/code.tar.gz" -C /opt/dsh-console .
sudo docker compose -p dsh-console stop console
sudo docker compose -p dsh-console run --rm --no-deps -T console tar -C /app/data -cf - . | sudo tee "$backup_dir/data.tar" >/dev/null
sudo chmod 600 "$backup_dir/data.tar" "$backup_dir/code.tar.gz"
sudo tar -tf "$backup_dir/data.tar"
sudo docker compose -p dsh-console start console
sudo docker compose -p dsh-console ps
~~~

已初始化的备份应包含 state.json。任一步失败先核实，不要把不完整备份当成功；即使备份失败，也可 start console 恢复服务。run 仅启动读卷打包任务，不运行第二个授权服务。

上面不含 Caddy 证书卷；原机升级必须保留 caddy-data、caddy-config。灾难迁移可在 DNS/网络正确时重新申请证书，但可能受签发限制；对恢复时效有要求，应额外按 Docker 卷备份流程保存这两个卷，不能公开证书私钥。

### 5.2 Docker：升级与恢复

先完成 5.1，再在 Mac 按 0.2 打包新代码并上传。服务器执行：

~~~bash
cd /opt/dsh-console
sudo docker compose -p dsh-console stop console
sudo tar -xzf /tmp/dsh-console-code.tar.gz -C /opt/dsh-console
sudo docker compose -p dsh-console config --quiet
sudo docker compose -p dsh-console up -d --build
sudo docker compose -p dsh-console ps
curl -fsS https://console.example.com/health
~~~

上传包不含 .env 与运行数据，不会重置管理员/密钥。失败时先保留日志和当前状态备份，再回退，不能覆盖唯一数据副本。

**恢复会覆盖当前应用状态，先对当前数据再做一次 5.1 备份。** 确认旧备份目录后执行；代码、状态、主密钥必须配套恢复。

~~~bash
set -o pipefail
cd /opt/dsh-console
restore_dir=/var/backups/dsh-console/替换成已确认的备份时间目录
sudo tar -tf "$restore_dir/data.tar"
sudo docker compose -p dsh-console stop console
sudo tar -xzf "$restore_dir/code.tar.gz" -C /opt/dsh-console
sudo install -m 0600 "$restore_dir/console.env" /opt/dsh-console/.env
sudo docker compose -p dsh-console build console
sudo cat "$restore_dir/data.tar" | sudo docker compose -p dsh-console run --rm --no-deps -T console tar -xf - -C /app/data
sudo docker compose -p dsh-console up -d
curl -fsS https://console.example.com/health
~~~

域名变化可以修改恢复后的域名配置，不能重新生成主密钥。新服务器要先安装 Docker，将 code.tar.gz 解压到 /opt/dsh-console 并还原 .env，才能执行 Compose 命令。迁移切换时停止旧服务器写入，不允许两个实例同时对外修改同一份业务状态。

### 5.3 Node/systemd：备份、升级与恢复

备份也需要短暂停写；私有配置单独保存：

~~~bash
backup_dir="/var/backups/dsh-console/$(date +%Y%m%d-%H%M%S)"
sudo install -d -m 0700 "$backup_dir"
sudo install -m 0600 /etc/dsh-console.env "$backup_dir/console.env"
sudo install -m 0600 /etc/systemd/system/dsh-console.service "$backup_dir/dsh-console.service"
sudo tar --exclude='./node_modules' -czf "$backup_dir/code.tar.gz" -C /opt/dsh-console .
sudo systemctl stop dsh-console
sudo tar -czf "$backup_dir/data.tar.gz" -C /var/lib/dsh-console .
sudo chmod 600 "$backup_dir/data.tar.gz" "$backup_dir/code.tar.gz"
sudo tar -tzf "$backup_dir/data.tar.gz"
sudo systemctl start dsh-console
curl -fsS http://127.0.0.1:8790/health
~~~

还应备份 Nginx 站点与证书运维设置；证书私钥不能放在公开共享目录。备份失败时先恢复服务，不能假定备份可用。

升级：上传新代码包，确认备份成功，再执行：

~~~bash
sudo systemctl stop dsh-console
sudo tar -xzf /tmp/dsh-console-code.tar.gz -C /opt/dsh-console
cd /opt/dsh-console
sudo env PATH=/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /opt/node22/bin/npm ci --omit=dev
sudo chown -R root:root /opt/dsh-console
sudo chmod -R go-w /opt/dsh-console
sudo chmod -R a+rX /opt/dsh-console
sudo systemctl start dsh-console
sudo systemctl status dsh-console --no-pager
curl -fsS https://console.example.com/health
~~~

不要重新创建 /etc/dsh-console.env 或清空 /var/lib/dsh-console。修改 unit 后需 daemon-reload。依赖安装失败不能继续启动，先修复或回退。

恢复前，**先备份当前状态并确认恢复点**，然后执行：

~~~bash
restore_dir=/var/backups/dsh-console/替换成已确认的备份时间目录
sudo tar -tzf "$restore_dir/data.tar.gz"
sudo systemctl stop dsh-console
sudo tar -xzf "$restore_dir/code.tar.gz" -C /opt/dsh-console
sudo install -m 0600 "$restore_dir/console.env" /etc/dsh-console.env
sudo tar -xzf "$restore_dir/data.tar.gz" -C /var/lib/dsh-console
sudo chown -R dsh-console:dsh-console /var/lib/dsh-console
sudo chmod 700 /var/lib/dsh-console
sudo chmod 600 /var/lib/dsh-console/state.json
cd /opt/dsh-console
sudo env PATH=/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /opt/node22/bin/npm ci --omit=dev
sudo systemctl start dsh-console
curl -fsS https://console.example.com/health
~~~

跨服务器还需按 B1–B5 配置 Node、账号、systemd、Nginx 与证书。不要只复制代码而漏掉状态/密钥；恢复服务定义时使用备份 unit 或与恢复版本兼容的配置，然后 daemon-reload。

### 5.4 安全边界

部署后也要定期安装操作系统、Node/Docker 镜像的安全更新。先备份、在隔离环境验证后再更新生产；不要在有进行中配对请求时随意重启。本文提供部署步骤，未代表已经在你的服务器完成安装或生产验收。

- 单实例文件存储，不允许多进程共用状态文件。扩容需数据库事务。
- data 状态文件权限 0600，AppSecret/授权密钥 AES-256-GCM 加密。备份必须同时保留 ACCESS_MASTER_KEY，丢失主密钥无法恢复密文。
- 浏览器 HttpOnly/SameSite Cookie，生产 HTTPS 使用 Secure；写操作检查 Origin 和 CSRF，管理 token 不存 localStorage。
- 无公开密码重置接口，丢失时由服务器运营者离线恢复。保管密码与备份。
- 不要删除数据卷或执行带 -v 的 compose down。升级先备份，再 docker compose up -d --build。
- 公网还需逐 IP 限流、监控和备份；本地测试不等于服务器生产验收。
- DSH 侧同时备份原设备状态文件及其 `.managed-access.json` 文件。不要单独删除限时状态文件或覆盖扩展，否则可能丢失到期控制。升级网关插件可能覆盖入口，升级后须检查限时能力并重新验证。

## 六、常见故障排查

| 现象 | 优先检查 | 处理方向 |
| --- | --- | --- |
| 域名无法打开 | DNS、安全组、80/443、服务是否启动 | getent ahosts、ss、Compose ps 或 systemctl status |
| Caddy 证书申请失败 | A/AAAA 是否指向本机、80/443 是否可达、额外代理 | 看 caddy 日志；修 DNS/防火墙，不关闭 TLS 校验 |
| 502 Bad Gateway | Node 未运行、容器不健康、反代地址错误 | Docker 用 exec 测内部 /health；Node 用本机 curl 8790 |
| Docker console healthy，外部仍 502 | .env 错填了 ACCESS_HOST=127.0.0.1 | Docker 内应监听 0.0.0.0，恢复 Dockerfile 默认后重新创建容器 |
| systemd status=203/EXEC | Node 路径、执行权限 | 检查 /opt/node22/bin/node --version 与 ExecStart |
| EACCES / 只读文件系统 | 数据写到程序目录、数据目录归属错误 | Node 使用 /var/lib/dsh-console，归属 dsh-console；容器用 /app/data 命名卷 |
| 首页白屏、JS/CSS 404 | 只传了 web、静态 location 截获、路径前缀错误 | 完整上传，所有 /console/* 转发 Node；独立域名根路径部署 |
| 登录提示 ORIGIN / CSRF | 浏览器域名与 CONSOLE_ORIGIN 不同、反代篡改 Origin、旧会话 | 使用一致的 HTTPS 域名，修配置后重启并重新登录；不要取消 CSRF |
| 浏览器能用，小程序不行 | request 合法域名、TLS、baseUrl、是否重编译 | 后台域名加入 request，小程序打包配置更新，真机验证 |
| 没有管理员入口 | 微信身份不匹配、申请未批准、服务未配置 | 网页核实当前 AppID 下的 OpenID 并批准；不使用昵称/微信号当 OpenID |
| 节点离线 | 连接器未运行、服务地址/token/本机 WebUI 端口错误 | 在 DSH 电脑检查配置，端口不是 8790 或网关 WS 端口；不公开凭据 |
| 限时配对按钮不可用 | 网关未开启中继或没有限时扩展 | 按第三节安装兼容扩展并在安全时机重启 DSH，等待心跳 |
| CONNECTOR_TIMEOUT | 电脑连接器响应超时、电脑睡眠/断网 | 先确认电脑在线；接口等待可能接近 20 秒，反代读超时须至少 35 秒 |
| ACCESS_POLICY_MISMATCH | 网关忽略了期限、源码不兼容、时钟错误 | 安装兼容扩展、正确校时；不能仅修改前端日期绕过 |
| 停用一直等待确认 | 电脑离线或连接器未能回传撤销结果 | 保留等待状态，检查连接器，不能手工改状态冒充已停用 |
| GRANT_NOT_CONFIGURED | 正在使用旧节点绑定码，但未配置兼容适配器 | 新服务选择账号公网码；旧码需要保留原授权接口，不能擅自转换 |
| RELAY_NOT_CONFIGURED | 缺少内部 relay 鉴权密钥 | 统一部署执行 bash upgrade.sh；不向客户端公开该密钥 |
| PUBLIC_ACCESS_REQUIRED / 公网到期 | 普通微信账号没有有效公网时长 | 在设置 → 公网访问兑换；局域网不受影响 |
| gateway-auth-upgrade-required | 电脑旧连接器未支持加密设备校验 | 按统一教程升级插件内置连接器，等待任务完成后正常重启 DSH |
| 429 Too Many Requests | 频繁点击/多用户登录/反代限流 | 等待窗口恢复，核对代理与应用限流，不无限重试或直接关闭保护 |
| 升级后又显示初始化 | 使用了新项目名/新数据卷/错数据路径 | 立即停止初始化，找回原状态与原主密钥；不要新建管理员覆盖 |
| Cannot read authorization state / 加密解密报错 | 状态文件损坏、主密钥不匹配 | 停止写入，保留当前文件，成套恢复备份；不要删除状态让它强行启动 |

当前服务只有单实例文件存储，而且应用不信任任意 X-Forwarded-For。反代后的部分应用级限流会共享代理出口地址；Nginx 的真实来源限流不能自动改变这一点。大量用户接入前需专门改造可信代理限流与数据库，不能用多进程/多副本共用 JSON 文件来扩容。

排错日志只分享错误码和脱敏文本，不分享 .env、完整配对字符串、连接器 token、AppSecret 或状态文件。HTTPS /health 成功只说明控制服务可用，不代表 DSH 中继和管理员身份已经验收。

### 官方参考

以下为安装/配置依据；本项目特定端口、环境变量和数据路径以本文及代码为准。不要在已有业务服务器上不加核对地执行官方卸载/重装步骤。

- Docker Ubuntu 安装：https://docs.docker.com/engine/install/ubuntu/
- Docker Compose 卷：https://docs.docker.com/reference/compose-file/volumes/
- Node.js 官方 22.x 文件与校验清单：https://nodejs.org/dist/latest-v22.x/
- Nginx 反向代理：https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- Certbot Nginx 与续签：https://eff-certbot.readthedocs.io/en/stable/using.html
- Caddy 自动 HTTPS：https://caddyserver.com/docs/automatic-https

## 七、检查

### 7.1 上线验收

- [ ] HTTPS /health 返回 {"ok":true}，首页 GET 返回 200，无证书警告。
- [ ] 初始化后能登录、退出、重新登录；未登录浏览器访问 /console/api/overview 返回 401。
- [ ] 公网未开放 8790，没有把源码、.env、数据目录设为网站根目录。
- [ ] 服务器重启后服务自动启动，管理员和节点记录仍在，没有回到初始化页。
- [ ] 小程序 request 合法域名和 baseUrl 指向管理后台；socket 合法域名仍使用真正的中继域名。
- [ ] 管理员绑定并批准后出现「生成配对码」，普通用户不显示，接口也拒绝普通用户。
- [ ] DSH 节点在线且支持限时扩展，网页/小程序显示相同签发记录、期限和停用状态。
- [ ] 专门测试设备完成配对、重连、停用验证；离线停用先待确认，节点上线确认后设备拒绝连接。
- [ ] 私有备份包含匹配的状态和主密钥，已在隔离环境验证恢复；不要拿生产数据做无备份恢复演练。

不要为验证到期而修改生产电脑/服务器时间，会影响证书、会话和其他任务。期限边界由自动化测试验证，真机到期测试安排独立环境。

### 7.2 自动化验证

本目录 npm test。完整项目回归在仓库根运行 node --test tests/*.test.js。测试使用假微信交换函数及假授权器，不消费真实登录码或给用户发权。

可选真实源码兼容检查：`DSH_GATEWAY_SOURCE=/绝对路径/dsh-plugin-weapp-gateway node --test test/gateway-compat.test.cjs`。只在临时副本安装并测试，不改正在运行的 DSH。正式上线需再验收 HTTPS、微信合法域名、管理员微信、电脑心跳及真机到期/撤销连接。
