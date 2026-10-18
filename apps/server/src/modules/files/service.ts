/**
 * 文件模块：入库、查询、DTO 转换、收录审核
 *
 * 收录口径（先审后公开）：
 *   投稿 → review_status='pending' → 只有投稿人自己和坞主看得到
 *   坞主放行 → 'approved' → 进入公开读取（/media 与文稿绑定才认得它）
 *   坞主退回 → 'rejected' → 带 review_note，同样只有投稿人与坞主可见
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FileItem, FileKind, ReviewStatus, Visibility } from '@cangjingwu/shared';
import { get, all, run } from '../../db/index.js';
import { newId, nowIso, sha256File } from '../../utils/ids.js';
import { ApiError } from '../../utils/response.js';
import { absFromRel, extOf, relFromStorage, sanitizeFilename, thumbsRoot } from '../../utils/paths.js';
import { makeThumbnail, probeMedia } from '../../utils/probe.js';
import { kindOf } from '../../middleware/upload.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

import { clampMinLevel } from '../../utils/levels.js';

/** files 表原始行；uploader_name 来自 LEFT JOIN users（查询里带出来） */
export interface FileRow {
  id: string;
  kind: FileKind;
  original_name: string;
  stored_name: string;
  ext: string;
  mime: string;
  size: number;
  rel_path: string;
  thumb_path: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  visibility: Visibility;
  /** 最低等级（1..9）：低于它的访客看不到这个文件 */
  min_level: number;
  review_status: ReviewStatus;
  review_note: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  uploaded_by: string | null;
  uploader_name?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** 数据库行 → 对外 DTO */
export function toFileItem(row: FileRow): FileItem {
  return {
    id: row.id,
    kind: row.kind,
    originalName: row.original_name,
    ext: row.ext,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    visibility: row.visibility,
    minLevel: row.min_level,
    reviewStatus: row.review_status,
    reviewNote: row.review_note ?? '',
    reviewedAt: row.reviewed_at,
    uploadedBy: row.uploaded_by,
    uploaderName: row.uploader_name ?? null,
    hasThumb: Boolean(row.thumb_path),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rawUrl: `/media/files/${row.id}`,
    thumbUrl: `/media/thumbs/${row.id}`,
  };
}

/** 统一带上投稿人用户名，省得每个调用点各写一次 JOIN */
const SELECT_WITH_UPLOADER =
  'SELECT f.*, u.username AS uploader_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by';

/** 取一行（默认排除已软删除） */
export function findFileRow(id: string, includeDeleted = false): FileRow | undefined {
  const sql = includeDeleted
    ? `${SELECT_WITH_UPLOADER} WHERE f.id = ?`
    : `${SELECT_WITH_UPLOADER} WHERE f.id = ? AND f.deleted_at IS NULL`;
  return get<FileRow>(sql, id);
}

/** 取一行，不存在则 404 */
export function requireFileRow(id: string, includeDeleted = false): FileRow {
  const row = findFileRow(id, includeDeleted);
  if (!row) throw ApiError.notFound('文件不存在');
  return row;
}

/** 相对路径 → 绝对路径（带穿越防护） */
export function fileAbsPath(row: FileRow): string {
  return absFromRel(row.rel_path);
}

export function thumbAbsPath(row: FileRow): string | null {
  return row.thumb_path ? absFromRel(row.thumb_path) : null;
}

/** 超过该体积不做 sha256（避免大视频上传时白等） */
const HASH_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 落库一个已由 multer 写盘的文件：探测元信息 → 生成缩略图 → 插入记录
 * 探测与缩略图都是**尽力而为**：没有 ffmpeg 时只是缺字段，不影响上传成功。
 *
 * 入库即 pending（除非 REVIEW_REQUIRED=0）：投稿不直接对外，等坞主在审核台放行。
 */
export async function ingestUploadedFile(
  file: Express.Multer.File,
  uploadedBy: string | null,
): Promise<FileItem> {
  if (!fs.existsSync(file.path)) throw ApiError.internal('上传的临时文件已丢失，请重试');

  const kind = kindOf(file.originalname);
  if (!kind) throw ApiError.badRequest(`不支持的文件类型：${file.originalname}`);

  const id = newId('file');
  const stat = fs.statSync(file.path);
  const relPath = relFromStorage(file.path);
  const now = nowIso();

  // 1) 元信息（时长/分辨率）
  const meta =
    kind === 'image' || kind === 'video' || kind === 'audio' ? await probeMedia(file.path) : null;

  // 2) 缩略图：图片与视频尝试生成；图片失败则回退为原图
  let thumbRel: string | null = null;
  if (kind === 'image' || kind === 'video') {
    const thumbAbs = path.join(thumbsRoot(), `${id}.jpg`);
    // 视频 seek 到 1/3 处取帧；静图必须传 null，否则 ffmpeg 退出 0 却不产出文件
    const atSeconds =
      kind === 'video' ? Math.max(0, Math.min(2, (meta?.durationMs ?? 4000) / 1000 / 3)) : null;
    const made = await makeThumbnail(file.path, thumbAbs, { atSeconds });
    if (made) thumbRel = relFromStorage(thumbAbs);
    else if (kind === 'image') thumbRel = relPath;
  }

  // 3) 小文件算摘要（用于去重/校验），大文件跳过
  let sha: string | null = null;
  if (stat.size <= HASH_MAX_BYTES) {
    try {
      sha = await sha256File(file.path);
    } catch {
      sha = null;
    }
  }

  // 收录口径由 REVIEW_REQUIRED 决定：1 = 先审后公开，0 = 投稿即公开
  const initialReview: ReviewStatus = config.review.enabled ? 'pending' : 'approved';

  run(
    `INSERT INTO files
      (id, kind, original_name, stored_name, ext, mime, size, rel_path, thumb_path, sha256,
       width, height, duration_ms, visibility, review_status, uploaded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, ?)`,
    id,
    kind,
    sanitizeFilename(file.originalname),
    path.basename(file.path),
    extOf(file.originalname),
    file.mimetype || 'application/octet-stream',
    stat.size,
    relPath,
    thumbRel,
    sha,
    meta?.width ?? null,
    meta?.height ?? null,
    meta?.durationMs ?? null,
    initialReview,
    uploadedBy,
    now,
    now,
  );

  logger.info(initialReview === 'pending' ? '投稿已入库（待审）' : '投稿已入库（直接公开）', {
    id,
    kind,
    name: file.originalname,
    size: stat.size,
    thumb: Boolean(thumbRel),
  });

  return toFileItem(requireFileRow(id));
}

export interface ListFileOptions {
  kind?: FileKind;
  visibility?: Visibility;
  reviewStatus?: ReviewStatus;
  q?: string;
  includeDeleted?: boolean;
  /** 只看某个人投的（会员看自己的；坞主不传则看全部） */
  uploadedBy?: string;
  offset: number;
  limit: number;
}

/** 列表 + 总数（一次构造 where，两处复用） */
export function listFiles(opts: ListFileOptions): { items: FileItem[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeDeleted) where.push('f.deleted_at IS NULL');
  if (opts.kind) {
    where.push('f.kind = ?');
    params.push(opts.kind);
  }
  if (opts.visibility) {
    where.push('f.visibility = ?');
    params.push(opts.visibility);
  }
  if (opts.reviewStatus) {
    where.push('f.review_status = ?');
    params.push(opts.reviewStatus);
  }
  if (opts.uploadedBy) {
    where.push('f.uploaded_by = ?');
    params.push(opts.uploadedBy);
  }
  if (opts.q) {
    where.push('f.original_name LIKE ?');
    params.push(`%${opts.q}%`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM files f ${clause}`, ...params)?.c ?? 0;
  const rows = all<FileRow>(
    `${SELECT_WITH_UPLOADER} ${clause} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    opts.limit,
    opts.offset,
  );

  return { items: rows.map(toFileItem), total };
}

/**
 * 公开影像列表：只出「已收录 + 公开 + 等级够」的图片 / 视频 / 音频。
 * 文库首页「影像」区用它，免登录可读。
 */
export function listPublicMedia(opts: {
  level: number;
  offset: number;
  limit: number;
  kind?: FileKind;
}): { items: FileItem[]; total: number } {
  const where = [
    'f.deleted_at IS NULL',
    "f.review_status = 'approved'",
    "f.visibility = 'public'",
    'f.min_level <= ?',
    "f.kind IN ('image','video','audio')",
  ];
  const params: unknown[] = [opts.level];
  if (opts.kind) {
    where.push('f.kind = ?');
    params.push(opts.kind);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM files f ${clause}`, ...params)?.c ?? 0;
  const rows = all<FileRow>(
    `${SELECT_WITH_UPLOADER} ${clause} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    opts.limit,
    opts.offset,
  );
  return { items: rows.map(toFileItem), total };
}

/** 各收录状态的数量（审核台顶部的计数） */
export function reviewCounts(uploadedBy?: string): Record<ReviewStatus, number> {
  const clause = uploadedBy ? 'WHERE deleted_at IS NULL AND uploaded_by = ?' : 'WHERE deleted_at IS NULL';
  const params = uploadedBy ? [uploadedBy] : [];
  const rows = all<{ review_status: ReviewStatus; c: number }>(
    `SELECT review_status, COUNT(*) AS c FROM files ${clause} GROUP BY review_status`,
    ...params,
  );
  const out = { pending: 0, approved: 0, rejected: 0 } as Record<ReviewStatus, number>;
  for (const r of rows) out[r.review_status] = r.c;
  return out;
}

/** 重命名 / 改可见性 */
export function updateFile(
  id: string,
  patch: { originalName?: string; visibility?: Visibility; minLevel?: number },
): FileItem {
  requireFileRow(id);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.originalName !== undefined) {
    const name = sanitizeFilename(patch.originalName);
    if (!name) throw ApiError.badRequest('文件名不能为空');
    sets.push('original_name = ?');
    params.push(name);
  }
  if (patch.visibility !== undefined) {
    if (patch.visibility !== 'public' && patch.visibility !== 'private') {
      throw ApiError.badRequest('visibility 只能是 public 或 private');
    }
    sets.push('visibility = ?');
    params.push(patch.visibility);
  }
  if (patch.minLevel !== undefined) {
    sets.push('min_level = ?');
    params.push(clampMinLevel(patch.minLevel));
  }
  if (sets.length === 0) throw ApiError.badRequest('没有需要更新的字段');

  sets.push('updated_at = ?');
  params.push(nowIso(), id);
  run(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return toFileItem(requireFileRow(id));
}

/**
 * 收录审核：坞主放行或退回。
 * 退回时 note 会原样回给投稿人，所以不强制填写，但空着就等于没说原因。
 */
export function reviewFile(
  id: string,
  action: 'approve' | 'reject',
  note: string,
  reviewerId: string,
): FileItem {
  requireFileRow(id);
  const status: ReviewStatus = action === 'approve' ? 'approved' : 'rejected';
  run(
    'UPDATE files SET review_status = ?, review_note = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?',
    status,
    note.slice(0, 500),
    nowIso(),
    reviewerId,
    nowIso(),
    id,
  );
  logger.info('收录审核', { id, action, reviewerId });
  return toFileItem(requireFileRow(id));
}

/** 软删除；purge=true 时连磁盘文件与缩略图一起删除 */
export function deleteFile(id: string, purge = false): { purged: boolean } {
  const row = requireFileRow(id);

  // 先解除文稿绑定，避免留下悬空引用
  run('DELETE FROM document_files WHERE file_id = ?', id);

  if (!purge) {
    run('UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
    return { purged: false };
  }

  removeFileFromDisk(row);
  run('DELETE FROM files WHERE id = ?', id);
  return { purged: true };
}

/** 从磁盘删除原文件与缩略图（容错：失败只记日志） */
export function removeFileFromDisk(row: FileRow): void {
  for (const rel of [row.rel_path, row.thumb_path]) {
    if (!rel) continue;
    try {
      const abs = absFromRel(rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (err) {
      logger.warn('删除磁盘文件失败（忽略）', { rel, error: (err as Error).message });
    }
  }
}
