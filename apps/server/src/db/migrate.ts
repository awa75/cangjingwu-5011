/**
 * 迁移：用 SQLite 内置的 user_version 做版本号，逐个应用未执行的迁移。
 * 新增结构变更时，往 migrations 数组尾部追加一项即可（不要修改已发布的项）。
 *
 * 新站把旧站 26.1.1 的 16 个增量迁移合并进了 schema.sql，所以 v1 是整库基线。
 * v2 起恢复「一版一个文件」的做法：每加一版就多一个 .sql，不再改 schema.sql。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, get, openDb } from './index.js';
import { logger } from '../utils/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  return [
    {
      version: 1,
      name: 'init',
      sql: fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'),
    },
    {
      version: 2,
      name: 'surveys',
      sql: fs.readFileSync(path.join(here, 'surveys-v2.sql'), 'utf8'),
    },
  ];
}

export function currentVersion(): number {
  const row = get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

export function migrate(): number {
  openDb();
  const migrations = loadMigrations().sort((a, b) => a.version - b.version);
  const before = currentVersion();
  let applied = 0;

  for (const m of migrations) {
    if (m.version <= before) continue;
    logger.info(`应用迁移 #${m.version} ${m.name}`);
    exec('BEGIN IMMEDIATE');
    try {
      exec(m.sql);
      exec(`PRAGMA user_version = ${m.version}`);
      exec('COMMIT');
      applied += 1;
    } catch (err) {
      exec('ROLLBACK');
      throw new Error(`迁移 #${m.version} (${m.name}) 失败：${(err as Error).message}`);
    }
  }

  const after = currentVersion();
  if (applied === 0) logger.info(`数据库结构已是最新（version=${after}）`);
  else logger.info(`数据库结构已更新：v${before} → v${after}`);
  return after;
}
