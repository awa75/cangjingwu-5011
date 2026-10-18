/**
 * 分享管理路由（需登录）
 *
 * 谁能分享什么：
 *   自己的文件   —— 任何登录者（投稿后想私下发给别人看）
 *   文稿         —— 只有坞主（文稿本来就是坞主建的）
 * 越权一律 403，不靠前端自觉。
 */
import express from 'express';
import type { ShareTargetType } from '@cangjingwu/shared';
import { requireAuth } from '../../middleware/auth.js';
import { ApiError, ok } from '../../utils/response.js';
import { findFileRow } from '../files/service.js';
import { createShare, listShares, revokeShare } from './service.js';

export const sharesRouter = express.Router();
sharesRouter.use(requireAuth);

/** GET /api/shares —— 全部分享（含已撤销/已过期）；坞主看全部，会员只看自己建的 */
sharesRouter.get('/', (_req, res) => {
  const items = listShares();
  ok(res, { items, total: items.length });
});

/**
 * POST /api/shares
 * body: { targetType: "file"|"document", targetId, expiresInHours?, maxViews? }
 */
sharesRouter.post('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetType = body.targetType as ShareTargetType;
  const targetId = typeof body.targetId === 'string' ? body.targetId : '';
  if (!targetId) throw ApiError.badRequest('缺少 targetId');

  const isOwner = Boolean(req.user?.isOwner);
  if (targetType === 'file') {
    const file = findFileRow(targetId);
    if (!file) throw ApiError.notFound('文件不存在');
    if (!isOwner && file.uploaded_by !== req.user?.sub) throw ApiError.forbidden('这不是你投的文件');
  } else if (targetType === 'document') {
    if (!isOwner) throw ApiError.forbidden('只有坞主能分享文稿');
  } else {
    throw ApiError.badRequest('targetType 只能是 file 或 document');
  }

  const item = createShare({
    targetType,
    targetId,
    expiresInHours: body.expiresInHours === undefined ? null : Number(body.expiresInHours),
    maxViews: body.maxViews === undefined ? null : Number(body.maxViews),
  });
  ok(res, item, '分享链接已生成', 201);
});

/** DELETE /api/shares/:id —— 撤销 */
sharesRouter.delete('/:id', (req, res) => {
  revokeShare(req.params.id);
  ok(res, null, '分享已撤回');
});
