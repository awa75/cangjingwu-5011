/**
 * 文件路由
 *
 * 守卫分三档（这是新站相对旧站最大的变化 —— 旧站整条路由都是 requireAdmin）：
 *   任何登录者  POST /upload           投稿；入库即 pending，并记下投稿人
 *   本人或坞主  其余读写接口           只能碰自己投的文件，坞主可碰全部
 *   仅坞主      PATCH /:id/review      放行 / 退回
 */
import express from 'express';
import type { FileKind, ReviewStatus, Visibility } from '@cangjingwu/shared';
import { ALLOWED_EXTENSIONS, uploadAny } from '../../middleware/upload.js';
import { requireAuth, requireOwner } from '../../middleware/auth.js';
import { ok, parsePaging, ApiError } from '../../utils/response.js';
import { config } from '../../config.js';
import { diskUsage, humanBytes, uploadDirFor } from '../../utils/paths.js';
import { sendStoredFile } from '../../utils/send.js';
import { logger } from '../../utils/logger.js';
import { promoteTextFileToDocument } from './promote.js';
import {
  deleteFile,
  fileAbsPath,
  ingestUploadedFile,
  listFiles,
  requireFileRow,
  reviewCounts,
  reviewFile,
  toFileItem,
  updateFile,
  type FileRow,
} from './service.js';
import { issuePreviewTicket, PREVIEW_TTL_SECONDS } from './preview.js';

export const filesRouter = express.Router();
filesRouter.use(requireAuth);

/** 上传前预检：磁盘余量（避免写满磁盘） */
function assertDiskSpace(): void {
  const { freeBytes } = diskUsage(uploadDirFor('other'));
  if (freeBytes > 0 && freeBytes < 200 * 1024 * 1024) {
    throw ApiError.tooLarge(`服务器剩余空间不足（仅 ${humanBytes(freeBytes)}），请先清理`);
  }
}

/** 只有投稿人本人或坞主能碰这个文件 */
function requireOwnFile(req: express.Request, id: string, includeDeleted = false): FileRow {
  const row = requireFileRow(id, includeDeleted);
  if (!req.user?.isOwner && row.uploaded_by !== req.user?.sub) {
    throw ApiError.forbidden('这不是你投的文件');
  }
  return row;
}

/**
 * POST /api/files/upload —— 投稿
 * 表单字段名任意（file / files / 自定义）；支持多文件。
 * 入库即 pending，等坞主在审核台放行后才对外可见。
 */
filesRouter.post('/upload', uploadAny, async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    throw ApiError.badRequest('没有收到文件：请用 multipart/form-data，字段名任意（如 file）');
  }
  assertDiskSpace();

  const items = [];
  for (const f of files) {
    items.push(await ingestUploadedFile(f, req.user?.sub ?? null));
  }
  ok(res, items, `已投递 ${items.length} 个文件，等待坞主收录`, 201);
});

/**
 * GET /api/files —— 列表
 * 会员只能看到自己投的（服务端强制，不看查询参数）；
 * 坞主可看全部，并可用 review / uploadedBy / kind / visibility / q 过滤。
 */
filesRouter.get('/', (req, res) => {
  const paging = parsePaging(req.query as Record<string, unknown>);
  const isOwner = Boolean(req.user?.isOwner);
  const reviewParam = typeof req.query.review === 'string' ? req.query.review : '';

  const { items, total } = listFiles({
    kind: (req.query.kind as FileKind) || undefined,
    visibility: (req.query.visibility as Visibility) || undefined,
    reviewStatus: isOwner && reviewParam ? (reviewParam as ReviewStatus) : undefined,
    q: typeof req.query.q === 'string' && req.query.q ? req.query.q : undefined,
    includeDeleted: isOwner && req.query.includeDeleted === '1',
    // 非坞主一律锁死在自己名下
    uploadedBy: isOwner
      ? typeof req.query.uploadedBy === 'string' && req.query.uploadedBy
        ? req.query.uploadedBy
        : undefined
      : (req.user?.sub ?? '__none__'),
    offset: paging.offset,
    limit: paging.limit,
  });
  ok(res, { items, total, page: paging.page, pageSize: paging.pageSize });
});

/** GET /api/files/meta/limits —— 供前端展示上传限制（必须排在 /:id 之前） */
filesRouter.get('/meta/limits', (_req, res) => {
  ok(res, {
    maxBytes: config.upload.maxBytes,
    maxFiles: config.upload.maxFiles,
    acceptedExtensions: ALLOWED_EXTENSIONS,
  });
});

/** GET /api/files/meta/review —— 各收录状态的数量（坞主审核台顶部计数） */
filesRouter.get('/meta/review', (req, res) => {
  const isOwner = Boolean(req.user?.isOwner);
  ok(res, reviewCounts(isOwner ? undefined : req.user?.sub));
});

/** GET /api/files/:id —— 详情（本人或坞主） */
filesRouter.get('/:id', (req, res) => {
  const row = requireOwnFile(req, req.params.id, req.user?.isOwner && req.query.includeDeleted === '1');
  ok(res, toFileItem(row));
});

/**
 * GET /api/files/:id/raw —— 私有文件预览（需登录，且本人或坞主）
 * 已收录的文件请走 /media/files/:id（免登录、带收录与可见性校验）。
 */
filesRouter.get('/:id/raw', (req, res, next) => {
  const row = requireOwnFile(req, req.params.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  sendStoredFile(res, next, fileAbsPath(row), {
    contentType: row.mime || 'application/octet-stream',
    filename: row.original_name,
    disposition: 'inline',
    cacheControl: 'private, max-age=0, must-revalidate',
  });
});

/**
 * POST /api/files/:id/preview-ticket —— 换一条 120 秒的预览直链（本人或坞主）
 *
 * 给审核台用：坞主要看得见才敢批，而 <img>/<video> 带不上 Authorization 头，
 * 公开的 /media 又对未收录文件 403。这里发的票只对这一个文件、只活 120 秒。
 * 直链形状见 shared 的 API.preview（/api/preview/:token）。
 */
filesRouter.post('/:id/preview-ticket', (req, res) => {
  // includeDeleted=true：已退回的文件坞主仍应能回看，才好判断要不要恢复
  const row = requireOwnFile(req, req.params.id, true);
  ok(res, {
    url: `/api/preview/${issuePreviewTicket(row.id, req.user!.sub)}`,
    expiresInSeconds: PREVIEW_TTL_SECONDS,
  });
});

/**
 * PATCH /api/files/:id/review —— 坞主放行 / 退回
 * body { action: 'approve' | 'reject', note?: string }
 */
filesRouter.patch('/:id/review', requireOwner, (req, res) => {
  const body = (req.body ?? {}) as { action?: unknown; note?: unknown };
  const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : null;
  if (!action) throw ApiError.badRequest("action 只能是 'approve' 或 'reject'");
  const note = typeof body.note === 'string' ? body.note : '';

  const item = reviewFile(String(req.params.id), action, note, req.user!.sub);

  // 收录即发布：Markdown / 纯文本投稿在这一步长成文库文稿。
  // 升格失败不回滚「已收录」—— 记日志，坞主仍可在编辑台手动建文稿兜底。
  let promoted: { id: string; slug: string; title: string } | null = null;
  if (action === 'approve') {
    try {
      promoted = promoteTextFileToDocument(item);
    } catch (err) {
      logger.warn('投稿升格为文稿失败', { fileId: item.id, error: (err as Error).message });
    }
  }

  ok(
    res,
    promoted ? { ...item, promotedDocument: promoted } : item,
    action === 'approve' ? (promoted ? '已收录，并已收入文库' : '已收录') : '已退回',
  );
});

/** PATCH /api/files/:id —— 重命名 / 改可见性（本人或坞主） */
filesRouter.patch('/:id', (req, res) => {
  requireOwnFile(req, req.params.id);
  const body = (req.body ?? {}) as {
    originalName?: unknown;
    visibility?: unknown;
    name?: unknown;
    minLevel?: unknown;
  };
  const patch: { originalName?: string; visibility?: Visibility; minLevel?: number } = {};
  if (typeof body.originalName === 'string') patch.originalName = body.originalName;
  if (typeof body.visibility === 'string') patch.visibility = body.visibility as Visibility;
  if (body.name !== undefined && typeof body.name === 'string') patch.originalName = body.name;
  if (body.minLevel !== undefined) patch.minLevel = Number(body.minLevel);

  const item = updateFile(req.params.id, patch);
  ok(res, item, '已更新');
});

/** DELETE /api/files/:id?purge=1 —— 本人或坞主；默认软删除，purge=1 连磁盘一起删 */
filesRouter.delete('/:id', (req, res) => {
  requireOwnFile(req, req.params.id, true);
  const purge = req.query.purge === '1';
  // 彻底删除只留给坞主，投稿人只能撤自己的（软删除）
  if (purge && !req.user?.isOwner) throw ApiError.forbidden('只有坞主能彻底删除');
  const result = deleteFile(req.params.id, purge);
  ok(res, result, purge ? '已彻底删除（含磁盘文件）' : '已移入回收（软删除）');
});
