#!/usr/bin/env bash
# ==========================================================================
# 《藏经坞》日常发布脚本（服务器上执行）
#
#   sudo bash deploy/deploy.sh
#
# 做的事：拉代码（若是 git 仓库）→ 装依赖 → 数据库迁移 → 构建前端（若存在）
#         → 重启服务 → 健康检查
# ==========================================================================
set -euo pipefail

APP_USER="${APP_USER:-cangjingwu}"
CODE_DIR="${CODE_DIR:-/opt/cangjingwu}"
ENV_FILE="${ENV_FILE:-/etc/cangjingwu/cangjingwu.env}"
PORT="${PORT:-8080}"

log()  { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 执行：sudo bash deploy/deploy.sh"
[[ -d "$CODE_DIR" ]] || die "找不到代码目录：$CODE_DIR"

cd "$CODE_DIR"

log "1/5 更新代码"
CODE_SYNCED=0
for arg in "$@"; do
  # 用 case 而不是 `[[ ... ]] && X=1`：后者在"最后一个参数不匹配"时会让整个 for
  # 返回非零，配 set -e 会**静默退出**（换个参数就中招，很难查）
  case "$arg" in
    --code-synced) CODE_SYNCED=1 ;;
  esac
done
if [[ -d .git ]]; then
  sudo -u "$APP_USER" -H git -C "$CODE_DIR" pull --ff-only
elif [[ "$CODE_SYNCED" -eq 1 ]]; then
  echo "代码已由 deploy/update.sh 同步并复核过，跳过拉取。"
else
  # ★ 这里以前是"打印一句跳过、然后照常继续"——结果是一次什么都没更新的发布
  #   也照样装依赖、构建、重启、健康检查全绿。旧代码 + 绿灯 = 最坏的一种"成功"。
  #   现在改成停下来，并指向正确的做法。
  cat <<'EOF'

  ┌────────────────────────────────────────────────────────────┐
  │ ⚠  这个目录不是 git 仓库，**本次运行不会更新任何代码**。     │
  └────────────────────────────────────────────────────────────┘

  它会照常装依赖、迁移数据库、构建前端、重启服务、跑到健康检查通过 ——
  但构建的是**旧源码**。用它来发新版是发不出去的，而失败看起来会像成功。

  发新版请用（会自己校验包、同步、并复核两边一致）：

      sudo bash deploy/update.sh --tarball /tmp/cangjingwu-vX.Y.Z-linux.tar.gz

  如果你确实已经自己同步过代码、只想重建一次：

      sudo bash deploy/deploy.sh --code-synced

EOF
  exit 1
fi

log "2/5 安装依赖"
sudo -u "$APP_USER" -H bash -lc "cd '$CODE_DIR' && pnpm install"

log "3/5 数据库迁移"
sudo -u "$APP_USER" -H env ENV_FILE="$ENV_FILE" bash -lc "cd '$CODE_DIR' && pnpm migrate"

log "4/5 构建前端（若存在 apps/web）"
if [[ -f "$CODE_DIR/apps/web/package.json" ]]; then
  sudo -u "$APP_USER" -H bash -lc "cd '$CODE_DIR' && pnpm build"
else
  echo "apps/web 尚未创建（第 2 阶段），跳过"
fi

log "5/5 重启服务"
systemctl restart cangjingwu-server
sleep 3

if ! systemctl is-active --quiet cangjingwu-server; then
  journalctl -u cangjingwu-server -n 40 --no-pager || true
  die "服务启动失败"
fi

if curl -fsS "http://127.0.0.1:${PORT}/api/health"; then
  echo
  echo "发布完成，健康检查通过。"
else
  die "健康检查失败：journalctl -u cangjingwu-server -n 80 --no-pager"
fi
