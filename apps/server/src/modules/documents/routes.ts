/**
 * 文稿路由（全部需要坞主登录）
 *
 * 公开读取走 /api/public/documents/*，不在这里。
 */
import express from 'express';
import { requireOwner } from '../../middleware/auth.js';
import { ApiError, ok } from '../../utils/response.js';
import {
  bindDocumentFile,
  createDocument,
  deleteDocument,
  listDocumentFiles,
  listDocuments,
  reorderDocuments,
  requireDocument,
  toDocumentItem,
  unbindDocumentFile,
  updateDocument,
} from './service.js';

export const documentsRouter = express.Router();
documentsRouter.use(requireOwner);

/** GET /api/documents —— 列表（不含正文，带摘要） */
documentsRouter.get('/', (req, res) => {
  const withContent = req.query.withContent === '1';
  const items = listDocuments({ withContent });
  ok(res, { items, total: items.length });
});

/** POST /api/documents —— 新建 */
documentsRouter.post('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title : '';
  if (!title.trim()) throw ApiError.badRequest('请提供 title');

  const item = createDocument({
    title,
    contentMd: typeof body.contentMd === 'string' ? body.contentMd : '',
    slug: typeof body.slug === 'string' ? body.slug : undefined,
    pinned: body.pinned === true,
    visible: body.visible !== false,
    minLevel: body.minLevel === undefined ? undefined : Number(body.minLevel),
  });
  ok(res, item, '文档已创建', 201);
});

/**
 * PATCH /api/documents/reorder —— 批量重排 / 批量改归属（管理员拖拽后一次提交）
 * body { items: [{ id, collectionId? }] }，数组顺序即最终顺序。
 * 必须在 /:id 类路由之前注册（这里只有一个 path 段，本无冲突，保持显式）。
 */
documentsRouter.patch('/reorder', (req, res) => {
  const body = (req.body ?? {}) as { items?: { id: string; collectionId?: string | null }[] };
  const n = reorderDocuments(body.items ?? []);
  ok(res, { reordered: n }, '顺序已保存');
});

/** GET /api/documents/:id —— 详情（含正文 + 绑定文件） */
documentsRouter.get('/:id', (req, res) => {
  const row = requireDocument(req.params.id);
  const item = toDocumentItem(row);
  ok(res, { ...item, files: listDocumentFiles(row.id) });
});

/** PUT /api/documents/:id —— 更新（含归属文件夹与排序） */
documentsRouter.put('/:id', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof updateDocument>[1] = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.contentMd === 'string') patch.contentMd = body.contentMd;
  if (typeof body.content_md === 'string') patch.contentMd = body.content_md;
  if (typeof body.slug === 'string') patch.slug = body.slug;
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
  if (typeof body.visible === 'boolean') patch.visible = body.visible;
  if (body.collectionId === null || typeof body.collectionId === 'string') patch.collectionId = body.collectionId;
  if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder);
  if (body.minLevel !== undefined) patch.minLevel = Number(body.minLevel);

  ok(res, updateDocument(req.params.id, patch), '已保存');
});

/* ------------------------------------------------ 绑定文件（文库「下载所有文件」） */

/** GET /api/documents/:id/files —— 这篇文稿绑定了哪些文件 */
documentsRouter.get('/:id/files', (req, res) => {
  requireDocument(req.params.id);
  const items = listDocumentFiles(req.params.id);
  ok(res, { items, total: items.length });
});

/** POST /api/documents/:id/files —— 绑定（body { fileId }）；绑定即把文件转为 public */
documentsRouter.post('/:id/files', (req, res) => {
  const body = (req.body ?? {}) as { fileId?: unknown };
  const fileId = typeof body.fileId === 'string' ? body.fileId : '';
  if (!fileId) throw ApiError.badRequest('缺少 fileId');
  ok(res, bindDocumentFile(req.params.id, fileId), '已绑定', 201);
});

/** DELETE /api/documents/:id/files/:fileId —— 解绑（文件本身不删） */
documentsRouter.delete('/:id/files/:fileId', (req, res) => {
  unbindDocumentFile(req.params.id, req.params.fileId);
  ok(res, null, '已解绑');
});

/** PATCH /api/documents/:id/pin —— 置顶开关 */
documentsRouter.patch('/:id/pin', (req, res) => {
  const body = (req.body ?? {}) as { pinned?: unknown };
  const pinned = body.pinned === false ? false : true;
  ok(res, updateDocument(req.params.id, { pinned }), pinned ? '已置顶' : '已取消置顶');
});

/** DELETE /api/documents/:id */
documentsRouter.delete('/:id', (req, res) => {
  deleteDocument(req.params.id);
  ok(res, null, '文档已删除');
});
