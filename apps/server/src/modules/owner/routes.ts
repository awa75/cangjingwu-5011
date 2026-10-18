/**
 * 坞主专属接口：概览统计、站点文案
 *
 * 挂在 /api/owner 下，全部 requireOwner。
 * 会员与邀请码那两块在 modules/members/routes.ts，同样挂在这个前缀下。
 * （旧站对应的是 /api/admin/*，那 21 页后台已经整体删除，只留下这里真正要用的。）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import type { StatsOverview } from '@cangjingwu/shared';
import { requireOwner } from '../../middleware/auth.js';
import { all, get } from '../../db/index.js';
import { ok } from '../../utils/response.js';
import { config } from '../../config.js';
import { dirSizeBytes, diskUsage, uploadsRoot } from '../../utils/paths.js';
import { getSettings, setSettings } from '../settings/service.js';
import { reviewCounts } from '../files/service.js';

export const ownerRouter = express.Router();
ownerRouter.use(requireOwner);

/** SQLite 主库 + WAL/SHM 的总字节数；目录不在就报 0，不让统计接口拖垮整个页面 */
function dbSizeBytes(): number {
  try {
    const dir = config.paths.dataDir;
    if (!fs.existsSync(dir)) return 0;
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm'))
      .reduce((sum, f) => {
        try {
          return sum + fs.statSync(path.join(dir, f)).size;
        } catch {
          return sum;
        }
      }, 0);
  } catch {
    return 0;
  }
}

/** ffmpeg 在不在 —— 只影响缩略图与时长，不影响收录 */
function ffmpegAvailable(): boolean {
  try {
    const r = spawnSync(config.media.ffmpegPath, ['-version'], { timeout: 3000, stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** GET /api/owner/stats —— 概览：稿件、待审、文稿、文件夹、分享、磁盘 */
ownerRouter.get('/stats', (_req, res) => {
  const byKindRows = all<{ kind: string; c: number }>(
    'SELECT kind, COUNT(*) AS c FROM files WHERE deleted_at IS NULL GROUP BY kind',
  );
  const byKind: Record<string, number> = {};
  for (const r of byKindRows) byKind[r.kind] = r.c;

  const counts = reviewCounts();

  const { totalBytes, freeBytes } = diskUsage(uploadsRoot());

  const stats: StatsOverview = {
    files: {
      total:
        get<{ c: number }>('SELECT COUNT(*) AS c FROM files WHERE deleted_at IS NULL')?.c ?? 0,
      byKind,
      totalBytes: get<{ s: number }>(
        'SELECT COALESCE(SUM(size), 0) AS s FROM files WHERE deleted_at IS NULL',
      )?.s ?? 0,
      pending: counts.pending,
    },
    documents: {
      total: get<{ c: number }>('SELECT COUNT(*) AS c FROM documents')?.c ?? 0,
    },
    collections: {
      total: get<{ c: number }>('SELECT COUNT(*) AS c FROM collections')?.c ?? 0,
    },
    shares: {
      total: get<{ c: number }>('SELECT COUNT(*) AS c FROM shares')?.c ?? 0,
      active:
        get<{ c: number }>(
          "SELECT COUNT(*) AS c FROM shares WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))",
        )?.c ?? 0,
    },
    storage: {
      diskTotalBytes: totalBytes,
      diskFreeBytes: freeBytes,
      storageBytes: dirSizeBytes(config.paths.storageDir),
    },
    system: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      dbSizeBytes: dbSizeBytes(),
      ffmpegAvailable: ffmpegAvailable(),
    },
  };
  ok(res, stats);
});

/** GET /api/owner/settings —— 全部站点文案（含非公开键） */
ownerRouter.get('/settings', (_req, res) => {
  ok(res, getSettings());
});

/** PATCH /api/owner/settings —— 批量改文案 */
ownerRouter.patch('/settings', (req, res) => {
  ok(res, setSettings((req.body ?? {}) as Record<string, unknown>), '文案已保存');
});
