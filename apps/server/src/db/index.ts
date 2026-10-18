/**
 * 数据库访问层（适配器）
 *
 * 使用 Node 24 内置的 node:sqlite，**无需原生编译**（不用 node-gyp / VS Build Tools）。
 * 对外只暴露 5 个方法（exec / run / get / all / tx），
 * 将来若要换成 better-sqlite3，只改本文件即可，业务代码零改动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

let db: DatabaseSync | null = null;

/** 初始化数据库连接（幂等）：建目录 → 打开 → 设置 PRAGMA */
export function openDb(): DatabaseSync {
  if (db) return db;

  fs.mkdirSync(config.paths.dataDir, { recursive: true });
  const file = path.join(config.paths.dataDir, 'app.db');

  db = new DatabaseSync(file);

  // WAL：读写并发更好；foreign_keys：让 ON DELETE CASCADE 生效
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');

  return db;
}

/** 获取连接（未初始化则自动初始化） */
export function getDb(): DatabaseSync {
  return db ?? openDb();
}

/** 数据库文件路径 */
export function dbFilePath(): string {
  return path.join(config.paths.dataDir, 'app.db');
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ---------------------------------------------------------------- 便捷方法

export function exec(sql: string): void {
  getDb().exec(sql);
}

/** 写操作，返回影响行数与自增 ID */
export function run(sql: string, ...params: unknown[]): RunResult {
  const stmt = getDb().prepare(sql);
  const r = stmt.run(...(params as never[]));
  return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
}

/** 取一行，无结果返回 undefined */
export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  const stmt = getDb().prepare(sql);
  return stmt.get(...(params as never[])) as T | undefined;
}

/** 取多行 */
export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  const stmt = getDb().prepare(sql);
  return stmt.all(...(params as never[])) as T[];
}

/**
 * 事务：BEGIN IMMEDIATE 立刻取写锁，避免"检查后再写"的竞态。
 * 用于任务领取、设置说明页等必须原子完成的场景。
 */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* 回滚失败说明事务已结束，忽略 */
    }
    throw err;
  }
}

/** 断言：为了让 TS 收窄，取不到就抛错（用于"必须存在"的场景） */
export function getOrThrow<T>(sql: string, ...params: unknown[]): T {
  const row = get<T>(sql, ...params);
  if (!row) throw new Error(`数据库查询无结果：${sql}`);
  return row;
}
