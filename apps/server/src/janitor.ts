/**
 * 后台定时清理（janitor）
 *
 * 每个 tick：
 *   1. 清理 storage/tmp 下的陈旧临时文件
 * 低频任务（每 120 个 tick ≈ 1 小时）：
 *   2. 清理 30 天前已撤销/已过期的分享记录
 *
 * 旧站这里还有：回收失联分析机的任务租约、清理终态任务、按月发放灵石、
 * 校验灵石账本不变量、清理孤儿 AI 会话 —— 那五件事随对应模块一并拆除。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { run } from './db/index.js';
import { logError, logger } from './utils/logger.js';
import { tmpRoot } from './utils/paths.js';

/** 删除 tmp 下超过保留期的文件 */
function cleanTmp(): number {
  const root = tmpRoot();
  if (!fs.existsSync(root)) return 0;

  const cutoff = Date.now() - config.janitor.tmpRetentionSeconds * 1000;
  let removed = 0;

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed += 1;
        }
      } catch {
        /* 单文件失败忽略 */
      }
    }
  };

  walk(root);
  return removed;
}

/** 清理失效的分享记录 */
function pruneDeadShares(olderThanDays = 30): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const result = run(
    `DELETE FROM shares
      WHERE created_at < ?
        AND (revoked = 1
             OR (expires_at IS NOT NULL AND expires_at < ?)
             OR (max_views IS NOT NULL AND views >= max_views))`,
    cutoff,
    new Date().toISOString(),
  );
  return result.changes;
}

export function startJanitor(): NodeJS.Timeout {
  let tickCount = 0;
  const intervalMs = Math.max(5, config.janitor.intervalSeconds) * 1000;

  const tick = (): void => {
    tickCount += 1;
    try {
      const tmpRemoved = cleanTmp();
      if (tmpRemoved > 0) logger.info(`清理临时文件 ${tmpRemoved} 个`);

      // 约每小时一次的重活
      if (tickCount % 120 === 0) {
        const shares = pruneDeadShares(30);
        if (shares) logger.info('定期清理完成', { shares });
      }
    } catch (err) {
      logError('janitor 执行失败', err);
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  logger.info(`janitor 已启动（每 ${config.janitor.intervalSeconds}s 一次）`);
  return timer;
}
