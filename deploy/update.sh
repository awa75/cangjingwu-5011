#!/usr/bin/env bash
# ==========================================================================
# 《藏经坞》更新代码（服务器上执行）—— 把"没更新成功却看起来成功"这件事堵死
#
#   sudo bash deploy/update.sh                          # 用当前所在的源码树
#   sudo bash deploy/update.sh --tarball /tmp/xxx.tar.gz
#   sudo bash deploy/update.sh --sha256 <64位十六进制>
#
# 为什么需要它（真实踩过的坑）：
#   2026 年那次发布，包传对了、SHA 也对，但代码没进 /opt/cangjingwu ——
#   因为 deploy.sh 在没有 git 仓库时会**打印一句跳过、然后照常继续**：
#   装依赖 → 构建 → 重启 → 健康检查全绿，看起来一次完美的发布，
#   实际是拿旧源码又构建了一遍。旧代码 + 绿的健康检查 = 最坏的一种"成功"。
#
# 本脚本的顺序是"每一步都自证"：
#   1) 解包到临时目录（先看包对不对）
#   2) 校验 SHA256（给了就核）
#   3) 检查解包结果里**必须有**的几个文件（包里的东西真在）
#   4) rsync 同步到代码目录
#   5) ★ 再跑一次 rsync --dry-run，**必须一行输出都没有**才算同步成功
#      （这是关键：不靠"rsync 没报错"，而是靠"两边已经一模一样"）
#   6) 才调用 deploy.sh（装依赖 / 迁移 / 构建 / 重启 / 健康检查）
# ==========================================================================
set -euo pipefail

APP_USER="${APP_USER:-cangjingwu}"
CODE_DIR="${CODE_DIR:-/opt/cangjingwu}"
ENV_FILE="${ENV_FILE:-/etc/cangjingwu/cangjingwu.env}"

TARBALL=""
EXPECT_SHA=""
EXIT_ON_DIRTY=1

log()  { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarball) TARBALL="${2:-}"; shift 2 ;;
    --sha256)  EXPECT_SHA="${2:-}"; shift 2 ;;
    --allow-dirty) EXIT_ON_DIRTY=0; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) die "不认识的参数：$1（--help 看用法）" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "请用 root 执行：sudo bash deploy/update.sh"
command -v rsync >/dev/null 2>&1 || die "缺 rsync：apt-get install -y rsync"

# ---------------------------------------------------------------- 1. 定出源目录
if [[ -n "$TARBALL" ]]; then
  [[ -f "$TARBALL" ]] || die "找不到压缩包：$TARBALL"

  log "1/6 校验压缩包"
  ACTUAL_SHA="$(sha256sum "$TARBALL" | awk '{print $1}')"
  echo "  文件：$TARBALL"
  echo "  SHA256：$ACTUAL_SHA"
  if [[ -n "$EXPECT_SHA" ]]; then
    [[ "${EXPECT_SHA,,}" == "$ACTUAL_SHA" ]] || die "SHA256 不匹配！期望 $EXPECT_SHA，实际 $ACTUAL_SHA（包传坏了或是旧包）"
    ok "SHA256 与给定的值一致"
  else
    warn '没给 --sha256，跳过比对（建议下次带上，能挡住「旧包同名」这类事）'
  fi

  STAGE="$(mktemp -d /tmp/cjw-update-XXXXXX)"
  trap 'rm -rf "$STAGE"' EXIT
  tar -xzf "$TARBALL" -C "$STAGE"
  SRC="$STAGE/cangjingwu"
  [[ -d "$SRC" ]] || die "压缩包里没有 cangjingwu/ 顶层目录，包结构不对"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
  log "1/6 使用当前源码树"
  echo "  源目录：$SRC"
fi

# ---------------------------------------------------------------- 2. 验货
log "2/6 检查源码完整性（这几样缺一个就说明包不对）"
MUST_HAVE=(
  "package.json"
  "pnpm-workspace.yaml"
  "apps/server/src/index.ts"
  "apps/web/package.json"
  "deploy/install.sh"
  "deploy/deploy.sh"
)
for f in "${MUST_HAVE[@]}"; do
  [[ -e "$SRC/$f" ]] || die "源目录里缺少 $f —— 这个包不完整，中止（没有动 /opt）"
done
ok "必需文件齐全（${#MUST_HAVE[@]} 项）"

[[ "$SRC" == "$CODE_DIR" ]] && die "源目录就是代码目录，没什么可同步的"

# ---------------------------------------------------------------- 3. 同步
log "3/6 同步到 $CODE_DIR"
mkdir -p "$CODE_DIR"
# 排除三样东西，各有理由：
#   node_modules —— 目标机上装出来的（npm/pnpm 的原生二进制按平台不同），排除后 --delete 才不会把它删掉
#   .env         —— 包里本来就没有（密钥不进包），排除掉免得被 --delete 误伤
#   dist         —— 前端构建产物。**故意不删**：留着它，构建即使失败，站点也还能用旧产物撑着；
#                   而 vite 每次构建本来就会清空自己的输出目录，不需要靠 --delete 来保证干净
RSYNC_EXCLUDES=(--exclude node_modules --exclude .env --exclude dist)
rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$SRC"/ "$CODE_DIR"/
ok "已同步"

# ---------------------------------------------------------------- 4. ★ 自证同步成功
log "4/6 复核同步结果（dry-run 必须一行输出都没有）"
DRY="$(rsync -a --delete --itemize-changes "${RSYNC_EXCLUDES[@]}" "$SRC"/ "$CODE_DIR"/ || true)"
if [[ -n "$DRY" ]]; then
  printf '%s\n' "$DRY" | head -20
  if [[ "$EXIT_ON_DIRTY" -eq 1 ]]; then
    die "复核发现两边仍不一致（上面列出的是差异）。**不要**继续发布 —— 先查清为什么同步不干净"
  fi
  warn "两边仍不一致，但你给了 --allow-dirty，继续"
else
  ok "源目录与 $CODE_DIR 已完全一致"
fi

# ---------------------------------------------------------------- 5. 归属
log "5/6 修正属主"
chown -R "$APP_USER:$APP_USER" "$CODE_DIR"
ok "$CODE_DIR 归属 $APP_USER"

# ---------------------------------------------------------------- 6. 发布
log "6/6 调用 deploy.sh（装依赖 → 迁移 → 构建前端 → 重启 → 健康检查）"
bash "$CODE_DIR/deploy/deploy.sh" --code-synced

cat <<'EOF'

──────────────────────────────────────────────
更新完成。建议再核一下：

  # 启动时有没有配置警告
  journalctl -u cangjingwu-server -n 60 --no-pager | grep -A3 '配置警告' || echo '（没有配置警告）'
──────────────────────────────────────────────
EOF
