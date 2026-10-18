/**
 * 路径与磁盘工具
 * 所有用户可控的路径都必须经过 absFromRel()，它保证结果不会逃出 STORAGE_DIR。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FileKind } from '@cangjingwu/shared';
import { config } from '../config.js';
import { ApiError } from './response.js';

/** 文件大类 → 存储子目录 */
const KIND_FOLDER: Record<FileKind, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio',
  doc: 'docs',
  other: 'others',
};

export function uploadsRoot(): string {
  return path.join(config.paths.storageDir, 'uploads');
}

export function thumbsRoot(): string {
  return path.join(config.paths.storageDir, 'thumbnails');
}

export function tmpRoot(): string {
  return path.join(config.paths.storageDir, 'tmp');
}

/** 某类文件在某月的目录（不存在则创建） */
export function uploadDirFor(kind: FileKind, date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dir = path.join(uploadsRoot(), KIND_FOLDER[kind], yyyy, mm);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 确保基础目录存在（启动时调用） */
export function ensureStorageDirs(): void {
  for (const d of [config.paths.storageDir, uploadsRoot(), thumbsRoot(), tmpRoot()]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const sub of Object.values(KIND_FOLDER)) {
    fs.mkdirSync(path.join(uploadsRoot(), sub), { recursive: true });
  }
}

/** 绝对路径 → 相对 STORAGE_DIR 的 posix 路径（存库用） */
export function relFromStorage(absPath: string): string {
  const rel = path.relative(config.paths.storageDir, absPath);
  return rel.split(path.sep).join('/');
}

/** 相对路径 → 绝对路径，并阻断目录穿越（../、绝对路径注入） */
export function absFromRel(relPath: string): string {
  if (!relPath) throw ApiError.badRequest('路径为空');
  const base = path.resolve(config.paths.storageDir);
  const abs = path.resolve(base, relPath.split('/').join(path.sep));
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw ApiError.forbidden('非法的文件路径');
  }
  return abs;
}

/** 文件存在且是普通文件 */
export function fileExists(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

/** 磁盘容量信息（字节） */
export function diskUsage(target: string): { totalBytes: number; freeBytes: number } {
  try {
    const st = fs.statfsSync(target);
    return { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize };
  } catch {
    return { totalBytes: 0, freeBytes: 0 };
  }
}

/** 目录占用（递归累加，失败返回 0） */
export function dirSizeBytes(dir: string): number {
  let total = 0;
  const walk = (p: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 单文件失败忽略 */
        }
      }
    }
  };
  walk(dir);
  return total;
}

/** 人类可读体积 */
export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 取扩展名（小写、不含点） */
export function extOf(filename: string): string {
  const e = path.extname(filename).replace('.', '').toLowerCase();
  return e.length > 10 ? e.slice(0, 10) : e;
}

/** 净化用户提供的文件名：去掉路径与危险字符，限制长度 */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim();
  const safe = base.replace(/^\.+/, '') || 'unnamed';
  return safe.length > 180 ? safe.slice(0, 180) : safe;
}
