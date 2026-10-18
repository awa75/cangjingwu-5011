/**
 * 分享访问路由（**免登录**，凭 token）
 *   GET /api/s/:token       → 元数据（并计入一次访问）
 *   GET /api/s/:token/raw   → 文件流 / 文档 markdown 原文
 */
import express from 'express';
import { ApiError, ok } from '../../utils/response.js';
import { absFromRel } from '../../utils/paths.js';
import { findDocumentById } from '../documents/service.js';
import { findFileRow } from '../files/service.js';
import { safeContentType } from '../files/serve.js';
import { sendStoredFile } from '../../utils/send.js';
import { countShareView, requireUsableShare, resolveShare } from './service.js';

export const sharePublicRouter = express.Router();

/** 元数据（前端分享页拿到标题、类型与内容） */
sharePublicRouter.get('/:token', (req, res) => {
  ok(res, resolveShare(req.params.token, { countView: true }));
});

/** 原始内容：文档返回 markdown 文本，文件返回字节流 */
sharePublicRouter.get('/:token/raw', (req, res, next) => {
  const row = requireUsableShare(req.params.token);
  // /raw 也计入访问次数，避免"只拉文件不计数"绕过 maxViews
  countShareView(row);

  if (row.target_type === 'document') {
    const doc = findDocumentById(row.target_id);
    if (!doc) throw ApiError.notFound('分享的文档已被删除');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(doc.content_md);
    return;
  }

  const file = findFileRow(row.target_id, true);
  if (!file) throw ApiError.notFound('分享的文件已被删除');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  sendStoredFile(res, next, absFromRel(file.rel_path), {
    contentType: safeContentType(file.mime, file.ext),
    filename: file.original_name,
    disposition: 'inline',
    cacheControl: 'private, max-age=0, must-revalidate',
  });
});
