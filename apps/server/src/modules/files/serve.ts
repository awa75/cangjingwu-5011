/**
 * 媒体出图出片：/media/thumbs/:id 与 /media/files/:id
 *
 * 为什么用"按 id 查库再 sendFile"而不是静态目录直出：
 *  1. 天然杜绝目录穿越（路径只来自数据库，且经过 absFromRel 二次校验）；
 *  2. 可以按 visibility **与收录状态**精确控制谁能看；
 *  3. 便于统一加安全响应头与缓存策略。
 *
 * 收录闸门就在这里：pending / rejected 的文件**免登录一律拿不到**，
 * 否则投稿人只要猜到 id 就能把未审的东西散布出去。
 */
import express from 'express';
import type { Response } from 'express';
import { optionalAuth } from '../../middleware/auth.js';
import { contentLevel, visibleTo } from '../../utils/levels.js';
import { fileExists } from '../../utils/paths.js';
import { ApiError } from '../../utils/response.js';
import { sendStoredFile } from '../../utils/send.js';
import { fileAbsPath, findFileRow, thumbAbsPath } from './service.js';

export const mediaRouter = express.Router();

/** 允许内联返回的 MIME 白名单；其余一律降级为 octet-stream（防止把上传物当 HTML/SVG 执行） */
const INLINE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/heic',
  'image/tiff',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'application/pdf',
]);

/** 依据 MIME/扩展名给出安全的 Content-Type */
export function safeContentType(mime: string, ext: string): string {
  const m = (mime || '').toLowerCase().split(';')[0]!.trim();
  if (INLINE_MIME.has(m)) return m;
  // 扩展名兜底映射
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    pdf: 'application/pdf',
  };
  return byExt[ext] ?? 'application/octet-stream';
}

/** 统一安全响应头 */
function setMediaHeaders(res: Response, contentType: string, isPublic: boolean): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // 即使被当成 HTML 打开，也不允许执行脚本
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Cache-Control',
    isPublic ? 'public, max-age=31536000, immutable' : 'private, max-age=0, must-revalidate',
  );
}

/**
 * 公共校验：取行 → 收录闸门 → 可见性 → 等级
 *
 * 谁能看某个文件：
 *   坞主            —— 全部
 *   投稿人本人      —— 自己投的（含未审、含私有），便于投稿后自查
 *   其他人/匿名     —— 必须 approved 且 visibility=public 且等级够
 */
function loadForRead(req: express.Request, id: string) {
  const row = findFileRow(id);
  if (!row) throw ApiError.notFound('文件不存在');

  const isOwner = Boolean(req.user?.isOwner);
  const isUploader = Boolean(req.user) && req.user?.sub === row.uploaded_by;
  const approved = row.review_status === 'approved';

  if (!approved && !isOwner && !isUploader) {
    throw ApiError.forbidden('这个文件还没有被坞主收录');
  }
  if (row.visibility !== 'public' && !isOwner && !isUploader) {
    throw ApiError.forbidden('该文件未公开，需要坞主身份或使用分享链接');
  }
  // 分级：低于该文件最低等级的访客看不到（连直链也不行）
  if (!visibleTo(row.min_level, contentLevel(req.user))) {
    throw ApiError.forbidden('该内容需要更高的等级');
  }
  return row;
}

/** 只有"对所有人可见"的文件才配长缓存；其余一律不许缓存 */
function isTrulyPublic(row: { review_status: string; visibility: string }): boolean {
  return row.review_status === 'approved' && row.visibility === 'public';
}

/** GET /media/thumbs/:id —— 缩略图（视频/图片）；无缩略图（或缩略图文件丢失）时回退原图 */
mediaRouter.get('/thumbs/:id', optionalAuth, (req, res, next) => {
  const row = loadForRead(req, String(req.params.id));
  const thumb = thumbAbsPath(row);
  // 自愈：库里记着有缩略图、磁盘上却没有（历史脏数据/手工清理）时，退回原图而不是 404
  const usableThumb = thumb && fileExists(thumb) ? thumb : null;
  const abs = usableThumb ?? fileAbsPath(row);
  const contentType = usableThumb ? 'image/jpeg' : safeContentType(row.mime, row.ext);
  setMediaHeaders(res, contentType, isTrulyPublic(row));
  sendStoredFile(res, next, abs, { contentType });
});

/** GET /media/files/:id —— 原文件 */
mediaRouter.get('/files/:id', optionalAuth, (req, res, next) => {
  const row = loadForRead(req, String(req.params.id));
  const contentType = safeContentType(row.mime, row.ext);
  setMediaHeaders(res, contentType, isTrulyPublic(row));
  sendStoredFile(res, next, fileAbsPath(row), {
    contentType,
    filename: row.original_name,
    disposition: 'inline',
  });
});
