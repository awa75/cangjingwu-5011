#!/usr/bin/env bash
# ==========================================================================
# 《藏经坞》Linux 首次部署脚本
#
# 用法（在服务器上，以 root 执行一次）：
#   cd /opt/cangjingwu            # 已解包/克隆的仓库目录
#   sudo bash deploy/install.sh                       # 装后端 + 构建前端（默认）
#   sudo bash deploy/install.sh --with-nginx --domain your.domain.com
#
# 可选参数：
#   --with-nginx          同时安装并配置 Nginx 反向代理
#   --domain <域名>        Nginx server_name（与 --with-nginx 搭配）
#   --port <端口>         后端监听端口（默认 8080）
#   --no-ffmpeg           不安装 ffmpeg（缩略图/时长将降级）
#
# 它会做九件事：系统依赖 → Node/pnpm → 运行用户与目录 → 生成配置 → 装依赖
#              → 构建前端 → 建库初始化 → 装 systemd 服务 → Nginx（可选）
# 脚本是幂等的：重复执行不会覆盖已有配置与数据库。
# ==========================================================================
set -euo pipefail

APP_USER="${APP_USER:-cangjingwu}"
CODE_DIR="${CODE_DIR:-/opt/cangjingwu}"
DATA_DIR="${DATA_DIR:-/var/lib/cangjingwu}"
CONF_DIR="${CONF_DIR:-/etc/cangjingwu}"
ENV_FILE="$CONF_DIR/cangjingwu.env"
NODE_MAJOR="${NODE_MAJOR:-24}"
WITH_NGINX=0
WITH_FFMPEG=1
DOMAIN=""
PORT=8080

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-nginx) WITH_NGINX=1 ;;
    --domain) DOMAIN="${2:-}"; shift ;;
    --port) PORT="${2:-8080}"; shift ;;
    --no-ffmpeg) WITH_FFMPEG=0 ;;
    -h|--help) usage ;;
    *) echo "未知参数：$1（用 --help 查看用法）" >&2; exit 1 ;;
  esac
  shift
done

log()  { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m[注意] %s\033[0m\n' "$*"; }
die()  { printf '\033[31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 执行：sudo bash deploy/install.sh"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$SRC_DIR/package.json" ]] || die "看起来不是在仓库根目录：$SRC_DIR"

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "系统：${PRETTY_NAME:-unknown}"
fi

# ---------------------------------------------------------------- 1. 系统依赖
log "1/9 安装系统依赖"
# ⚠️ xz 的包名按发行版不同，不能写死：
#   Debian/Ubuntu 叫 xz-utils；RHEL 系（dnf/yum）才叫 xz。
#   写死成 xz 会让 Ubuntu 直接 `E: Unable to locate package xz` 卡在第一步（踩过）。
PKGS=(curl ca-certificates gnupg tar rsync)
if command -v apt-get >/dev/null 2>&1; then
  PKGS+=(xz-utils)
else
  PKGS+=(xz)
fi
[[ $WITH_FFMPEG -eq 1 ]] && PKGS+=(ffmpeg)

# Node 官方 tarball 兜底（Aliyun Linux / openEuler 上 NodeSource 不认 ID 时用）
install_node_tarball() {
  local node_arch ver tarball
  case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64 | arm64) node_arch=arm64 ;;
    *) die "未知 CPU 架构 $(uname -m)，请手动安装 Node ${NODE_MAJOR}" ;;
  esac
  tarball="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/" \
    | grep -oE "node-v${NODE_MAJOR}\.[0-9.]+-linux-${node_arch}\.tar\.xz" | head -1)"
  [[ -n "$tarball" ]] || die "无法确定 Node ${NODE_MAJOR} 的 tarball 下载地址"
  echo "下载并安装：$tarball → /usr/local"
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${tarball}" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
  hash -r
}

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y "${PKGS[@]}"
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y "${PKGS[@]}"
elif command -v yum >/dev/null 2>&1; then
  yum install -y "${PKGS[@]}"
else
  warn "未识别的包管理器，请自行确保已安装：${PKGS[*]}"
fi

# ---------------------------------------------------------------- 2. Node
log "2/9 检查 Node.js（需要 >= 22.5，推荐 24）"
need_node=1
if command -v node >/dev/null 2>&1; then
  cur_major="$(node -p 'process.versions.node.split(".")[0]')"
  cur_minor="$(node -p 'process.versions.node.split(".")[1]')"
  if [[ "$cur_major" -gt 22 ]] || { [[ "$cur_major" -eq 22 ]] && [[ "$cur_minor" -ge 5 ]]; }; then
    need_node=0
    echo "已满足：$(node -v)"
  fi
fi

if [[ $need_node -eq 1 ]]; then
  echo "安装 Node.js ${NODE_MAJOR}.x"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  else
    # RHEL 系（CentOS / Alma / Rocky）：NodeSource 官方 rpm 源。
    # 阿里云 Alinux、openEuler 等 ID 不在 NodeSource 白名单里，脚本会报 Unsupported distribution，
    # 这时退回 Node 官方 tarball 装到 /usr/local（对所有发行版都有效）。
    if ! { curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - && { dnf install -y nodejs || yum install -y nodejs; }; }; then
      warn "NodeSource 源安装失败（Aliyun Linux / openEuler 等常见），改用 Node 官方 tarball"
      install_node_tarball
    fi
  fi
fi
node -v

if ! command -v pnpm >/dev/null 2>&1; then
  echo "安装 pnpm"
  npm install -g pnpm
fi
pnpm -v

# systemd 需要的 node 绝对路径：探测真实值，避免 nvm 装的 node 导致服务 203/EXEC 起不来
NODE_BIN="$(command -v node)"
echo "node 路径：$NODE_BIN"
if [[ "$NODE_BIN" == /root/* || "$NODE_BIN" == */.nvm/* ]]; then
  warn "node 位于 $NODE_BIN，该路径可能对运行用户 $APP_USER 不可读。"
  warn "建议改用系统级 Node（apt-get install -y nodejs）后再执行本脚本，否则服务可能启动失败。"
fi

# ---------------------------------------------------------------- 3. 用户与目录
log "3/9 创建运行用户与目录"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
  echo "已创建用户：$APP_USER"
fi
mkdir -p "$CODE_DIR" "$DATA_DIR/data" "$DATA_DIR/storage" "$CONF_DIR"

if [[ "$SRC_DIR" != "$CODE_DIR" ]]; then
  echo "复制代码：$SRC_DIR → $CODE_DIR"
  rsync -a --delete \
    --exclude 'node_modules' --exclude '.env' --exclude '.git' \
    --exclude 'data' --exclude 'storage' --exclude 'dist-linux' \
    "$SRC_DIR"/ "$CODE_DIR"/
fi

# 存储目录里的上传物不保留执行位。
# 注意：只处理**文件**——目录必须保留 x 位，否则连进入目录都不行（会直接把服务写崩）。
find "$DATA_DIR/storage" -type f -exec chmod a-x {} + 2>/dev/null || true
# 目录权限：属主可读写进入，其它人不可访问
find "$DATA_DIR/storage" -type d -exec chmod 750 {} + 2>/dev/null || true

# ---------------------------------------------------------------- 4. 配置文件
log "4/9 生成配置文件 $ENV_FILE"
if [[ ! -f "$ENV_FILE" ]]; then
  JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  WORKER_KEY="$(openssl rand -hex 32)"
  ADMIN_PASS="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
  # AI_KEY_SECRET 是**加密所有 API Key 的主密钥**（站主的 Key + 每个会员自带的 Key）。
  # 漏了它就会照抄 .env.example 里那个公开的占位串 —— 等于把加密过的 Key 送给任何拿到库的人。
  AI_KEY_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  BASE_URL="http://${DOMAIN:-localhost:${PORT}}"

  sed \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    -e "s|^HOST=.*|HOST=127.0.0.1|" \
    -e "s|^PORT=.*|PORT=${PORT}|" \
    -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${BASE_URL}|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" \
    -e "s|^WORKER_API_KEY=.*|WORKER_API_KEY=${WORKER_KEY}|" \
    -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASS}|" \
    -e "s|^AI_KEY_SECRET=.*|AI_KEY_SECRET=${AI_KEY_SECRET}|" \
    -e "s|^# *DATA_DIR=.*|DATA_DIR=${DATA_DIR}/data|" \
    -e "s|^# *STORAGE_DIR=.*|STORAGE_DIR=${DATA_DIR}/storage|" \
    -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=|" \
    "$CODE_DIR/.env.example" > "$ENV_FILE"

  chmod 600 "$ENV_FILE"
  ADMIN_PASS_PRINT="$ADMIN_PASS"
  WORKER_KEY_PRINT="$WORKER_KEY"
else
  echo "已存在，保持不变（如需重置请先备份再删除该文件）"
  ADMIN_PASS_PRINT="(沿用原配置)"
  WORKER_KEY_PRINT="(沿用原配置)"
fi
chown -R "$APP_USER:$APP_USER" "$CODE_DIR" "$DATA_DIR"
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ---------------------------------------------------------------- 5. 依赖
log "5/9 安装 Node 依赖"
sudo -u "$APP_USER" -H bash -lc "cd '$CODE_DIR' && pnpm install"

# ---------------------------------------------------------------- 6. 前端
log "6/9 构建前端（apps/web → apps/web/dist，之后由后端同源托管）"
if [[ -d "$CODE_DIR/apps/web" ]]; then
  sudo -u "$APP_USER" -H bash -lc "cd '$CODE_DIR' && pnpm build"
else
  warn "没有 apps/web 目录，跳过前端构建（后端将只提供 API）"
fi

# ---------------------------------------------------------------- 7. 数据库
log "7/9 初始化数据库（建表 + 管理员 + 站点文案 + 说明页占位文档）"
sudo -u "$APP_USER" -H env ENV_FILE="$ENV_FILE" bash -lc "cd '$CODE_DIR' && pnpm migrate"

# ---------------------------------------------------------------- 8. systemd
log "8/9 安装 systemd 服务"
sed -e "s|@CODE_DIR@|$CODE_DIR|g" -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@NODE_BIN@|$NODE_BIN|g" \
  "$CODE_DIR/deploy/systemd/cangjingwu-server.service" \
  > /etc/systemd/system/cangjingwu-server.service
systemctl daemon-reload
systemctl enable cangjingwu-server >/dev/null
systemctl restart cangjingwu-server
sleep 3

if systemctl is-active --quiet cangjingwu-server; then
  echo "服务已启动：cangjingwu-server"
else
  warn "服务未处于 active，请查看日志：journalctl -u cangjingwu-server -n 50 --no-pager"
fi

# ---------------------------------------------------------------- 8. Nginx
log "9/9 Nginx 反向代理"
if [[ $WITH_NGINX -eq 1 ]]; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y nginx
  else
    dnf install -y nginx || yum install -y nginx
  fi

  NGINX_CONF="$(sed "s|@DOMAIN@|${DOMAIN:-_}|g" "$CODE_DIR/deploy/nginx/cangjingwu.conf")"
  if [[ -d /etc/nginx/sites-enabled ]]; then
    # Debian / Ubuntu 布局
    printf '%s\n' "$NGINX_CONF" > /etc/nginx/sites-available/cangjingwu.conf
    ln -sf /etc/nginx/sites-available/cangjingwu.conf /etc/nginx/sites-enabled/cangjingwu.conf
    rm -f /etc/nginx/sites-enabled/default
  else
    # RHEL 系（Aliyun Linux / CentOS / Alma / Rocky）：
    # nginx 只 include /etc/nginx/conf.d/*.conf，**没有** sites-available/enabled 目录
    printf '%s\n' "$NGINX_CONF" > /etc/nginx/conf.d/cangjingwu.conf
    if [[ -f /etc/nginx/conf.d/default.conf ]]; then
      mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.disabled
      echo "已挪走默认站点：/etc/nginx/conf.d/default.conf → .disabled（它占着 80 端口）"
    fi
  fi

  nginx -t
  # nginx 可能尚未运行（新装或刚装好），所以先确保启动再 reload
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl reload nginx 2>/dev/null || systemctl restart nginx

  # SELinux（Aliyun Linux / CentOS 默认 enforcing）禁止 nginx 主动外连，
  # 不放开这个布尔值，反代会一直 502，而 nginx 日志只写 "Permission denied"。
  if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" == "Enforcing" ]]; then
    if command -v setsebool >/dev/null 2>&1; then
      setsebool -P httpd_can_network_connect 1 && echo "SELinux：已放开 httpd_can_network_connect（允许 nginx 反代到 127.0.0.1）"
    else
      warn "SELinux 处于 Enforcing 但找不到 setsebool，反代可能 502；请手动执行：setsebool -P httpd_can_network_connect 1"
    fi
  fi

  echo "Nginx 已配置 server_name=${DOMAIN:-_}（HTTPS 见 deploy/nginx/cangjingwu.conf 末尾说明）"
else
  echo "已跳过（需要时执行：sudo bash deploy/install.sh --with-nginx --domain your.domain.com）"
fi

# ---------------------------------------------------------------- 自检与提示
log "自检"
sleep 1
if curl -fsS "http://127.0.0.1:${PORT}/api/health"; then
  echo
  echo "健康检查通过。"
else
  warn "健康检查失败，请查看：journalctl -u cangjingwu-server -n 80 --no-pager"
fi

# 收尾提示按发行版给对应命令（Debian 系 ufw+apt / RHEL 系 firewalld+dnf）
if command -v ufw >/dev/null 2>&1; then
  FW_HINT="sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full'"
elif command -v firewall-cmd >/dev/null 2>&1; then
  FW_HINT="sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload"
else
  FW_HINT="（未检测到 ufw/firewalld；按需放行 80/443）"
fi

if command -v apt-get >/dev/null 2>&1; then
  CERT_HINT="sudo apt install -y certbot python3-certbot-nginx"
else
  CERT_HINT="sudo dnf install -y epel-release && sudo dnf install -y certbot python3-certbot-nginx"
fi

cat <<EOF

==========================================================================
部署完成
--------------------------------------------------------------------------
代码目录      : $CODE_DIR
数据目录      : $DATA_DIR   (data/app.db + storage/)
配置文件      : $ENV_FILE
服务名        : cangjingwu-server
查看日志      : journalctl -u cangjingwu-server -f
管理员账号    : $(grep -E '^ADMIN_USERNAME=' "$ENV_FILE" | cut -d= -f2-)
管理员密码    : $ADMIN_PASS_PRINT
分析机 API Key: $WORKER_KEY_PRINT
--------------------------------------------------------------------------
还需你手动完成（脚本不便代劳）：
1) 云厂商安全组（腾讯云 / 阿里云同理）：入站放行 22（限你的来源 IP）、80、443；
   **不要**放行 ${PORT}
2) 服务器本机防火墙：$FW_HINT
3) 大陆地域的域名需完成 ICP 备案，否则 80/443 会被拦截
4) 启用 HTTPS：$CERT_HINT && sudo certbot --nginx -d 你的域名
   证书就绪后，把 $ENV_FILE 里的 PUBLIC_BASE_URL 改成 https://你的域名，
   再执行 systemctl restart cangjingwu-server（分享链接用这个地址拼，改完才是 https 链接）
==========================================================================
EOF
