#!/usr/bin/env bash
# ==========================================================================
# 《藏经坞》备份脚本（服务器上执行，建议加进 crontab）
#
#   sudo bash deploy/backup.sh
#   每天 3 点：sudo crontab -e  →  0 3 * * * bash /opt/cangjingwu/deploy/backup.sh >> /var/log/cangjingwu-backup.log 2>&1
#
# 备份内容：
#   1) SQLite 一致性快照（VACUUM INTO，热备份，不需要停服务）
#   2) storage/ 目录（上传的原文件与缩略图）
#   3) ★ 配置与密钥（/etc/cangjingwu/）—— 没有它，前两样是**废的**
#
# ★ 为什么第 3 项是必须的（真实教训）：
#   数据库里的 ai_site_key_cipher（站主 AI Key）和每个会员自带的 Key，
#   都是用 AES-256-GCM 加密后落库的，主密钥就是 cangjingwu.env 里的 AI_KEY_SECRET。
#   只恢复数据库、不恢复那份配置 → 所有 AI Key 全部解不开（decryptSecret 返回空串，
#   表现为"站主没配 Key""会员的 Key 消失"），而且**不可逆**。
#   WORKER_API_KEY / JWT_SECRET / mTLS 的 ca.key 同理。
#   所以：这个备份目录本身就是**最高机密**，别往网盘、群里、别人机器上随手扔。
# ==========================================================================
set -euo pipefail
# ★ 默认新建的文件一律私有（0600 / 0700）。
#   这份备份里既有会员数据，又有能解开所有 AI Key 的主密钥 —— 不能有任何一步依赖"事后记得 chmod"。
umask 077

CODE_DIR="${CODE_DIR:-/opt/cangjingwu}"
CONF_DIR="${CONF_DIR:-/etc/cangjingwu}"
ENV_FILE="${ENV_FILE:-$CONF_DIR/cangjingwu.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cangjingwu}"
KEEP="${KEEP:-7}"
# 可选：异地备份目标（例如分析机或本机挂载盘），留空则跳过
REMOTE="${REMOTE:-}"

# 从环境文件里取一两个键（**不整体 source**，免得把 AI_KEY_SECRET 之类灌进环境）
env_get() {
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '"' | tr -d "'"
}
# 数据目录：与 apps/server/src/config.ts 的 DATA_DIR 同源
DATA_DIR="${DATA_DIR:-$(env_get DATA_DIR)}"
DATA_DIR="${DATA_DIR:-/var/lib/cangjingwu/data}"
# 上传的原文件：默认是 DATA_DIR 的隔壁（config.ts 的 STORAGE_DIR 默认就是这么算的）
STORAGE_DIR="${STORAGE_DIR:-$(env_get STORAGE_DIR)}"
STORAGE_DIR="${STORAGE_DIR:-$(dirname "$DATA_DIR")/storage}"

log() { printf '\033[36m[%s] %s\033[0m\n' "$(date '+%F %T')" "$*"; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

log "备份数据库 → $BACKUP_DIR/app-$STAMP.db"
# ★ 必须把 ENV_FILE 传下去：backup-db.mjs 靠它找 DATA_DIR（生产的库不在仓库目录里）
ENV_FILE="$ENV_FILE" node "$CODE_DIR/scripts/backup-db.mjs" "$BACKUP_DIR/app-$STAMP.db"

if [[ -d "$STORAGE_DIR" ]]; then
  log "备份文件存储 → $BACKUP_DIR/storage-$STAMP.tar.gz（$STORAGE_DIR）"
  tar -czf "$BACKUP_DIR/storage-$STAMP.tar.gz" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
else
  log "警告：没找到存储目录 $STORAGE_DIR —— 这次**没**备份上传的原文件"
fi

# ---------------------------------------------------------------- 配置与密钥
# 只打包**确实存在**的文件：全新机器上 mtls/ 可能还没有，硬打会报错退出（set -e）
CONF_ITEMS=()
[[ -f "$CONF_DIR/cangjingwu.env" ]] && CONF_ITEMS+=(cangjingwu.env)
[[ -d "$CONF_DIR/mtls" ]] && CONF_ITEMS+=(mtls)
if [[ ${#CONF_ITEMS[@]} -gt 0 ]]; then
  log "备份配置与密钥 → $BACKUP_DIR/env-$STAMP.tar.gz（含 ${CONF_ITEMS[*]}）"
  tar -czf "$BACKUP_DIR/env-$STAMP.tar.gz" -C "$CONF_DIR" "${CONF_ITEMS[@]}"
  # 最高机密：目录 700、文件 600，别的用户连读都读不到
  chmod 600 "$BACKUP_DIR/env-$STAMP.tar.gz"
else
  log "警告：$CONF_DIR 下没有找到 cangjingwu.env —— 这次备份**不完整**，恢复时 AI Key 会解不开"
fi

log "清理旧备份（保留最近 $KEEP 份）"
# 注意 set -o pipefail 下，glob 不匹配会让 ls 返回非 0 从而中断脚本，所以都要 || true
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/app-*.db 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f || true
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/storage-*.tar.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f || true
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/env-*.tar.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f || true

if [[ -n "$REMOTE" ]]; then
  log "异地同步 → $REMOTE"
  # 异地那份也含全部密钥，目标目录权限自己也要管好
  rsync -a --delete "$BACKUP_DIR"/ "$REMOTE"/
fi

log "完成。当前备份："
du -sh "$BACKUP_DIR"/* 2>/dev/null | tail -n 5 || true
log "恢复备忘：解出 env-*.tar.gz 放回 $CONF_DIR（权限 600）→ 再恢复 app-*.db 与 storage/ → 重启 cangjingwu-server"
