/**
 * 文库文件夹路由（需坞主登录）
 *   GET    /api/collections            全部文件夹（含隐藏）
 *   POST   /api/collections            新建
 *   PATCH  /api/collections/reorder    批量排序（坞主拖拽）
 *   GET    /api/collections/:id        详情（含夹内文稿）
 *   PUT    /api/collections/:id        改名 / 摘要 / 卷首说明 / 封面 / 排序 / 显隐
 *   DELETE /api/collections/:id        删除（夹内文稿回到「未归档」，文件不动）
 *
 * 公开读取走 /api/public/collections。
 */
import express from 'express';
import { requireOwner } from '../../middleware/auth.js';
import { ok } from '../../utils/response.js';
import {
  createCollection,
  deleteCollection,
  listCollections,
  reorderCollections,
  requireCollectionRow,
  toCollectionItem,
  updateCollection,
} from './service.js';

export const collectionsRouter = express.Router();
collectionsRouter.use(requireOwner);

collectionsRouter.get('/', (_req, res) => {
  const items = listCollections({ kind: 'library' });
  ok(res, { items, total: items.length });
});

collectionsRouter.post('/', (req, res) => {
  ok(res, createCollection((req.body ?? {}) as Record<string, unknown>), '文件夹已创建', 201);
});

/** 批量排序：body { items: [{ id }] }，数组顺序即最终顺序 */
collectionsRouter.patch('/reorder', (req, res) => {
  const body = (req.body ?? {}) as { items?: { id: string; sortOrder?: number }[] };
  const n = reorderCollections(body.items ?? []);
  ok(res, { reordered: n }, '顺序已保存');
});

collectionsRouter.get('/:id', (req, res) => {
  const row = requireCollectionRow(req.params.id);
  ok(res, { collection: toCollectionItem(row) });
});

collectionsRouter.put('/:id', (req, res) => {
  ok(res, updateCollection(req.params.id, (req.body ?? {}) as Record<string, unknown>), '已更新');
});

collectionsRouter.delete('/:id', (req, res) => {
  ok(res, deleteCollection(req.params.id), '文件夹已删除');
});
