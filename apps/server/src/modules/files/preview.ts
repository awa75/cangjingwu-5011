/**
 * 审核预览票（坞主"看得见才敢批"的那条通道）
 *
 * 问题：审核台要预览待审文件，但
 *   ① 公开的 /media/files/:id 对未收录文件一律 403（这是对的，不能松）
 *   ② <img> / <video> / <audio> 带不上 Authorization 头，没法用登录令牌
 *
 * 解法：坞主（或投稿人本人）先 POST /api/files/:id/preview-ticket 换一条直链，
 * 直链里是一个 120 秒有效、只对这一个文件生效的签名票。
 *
 * 为什么不是把 JWT 塞进 query：登录令牌会长期有效，一旦落进访问日志、Referer
 * 或截图就等于永久泄露；票只活 120 秒、只能读一个文件，最坏情况损失有限。
 *
 * 走 res.sendFile 发送，因此天然支持 Range —— 视频可以在审核台里拖进度条。
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { ApiError } from '../../utils/response.js';
import { sendStoredFile } from '../../utils/send.js';
import { fileAbsPath, requireFileRow } from './service.js';

/** 票的有效期（秒）。够点开看一眼，不够被谁存下来反复用 */
export const PREVIEW_TTL_SECONDS = 120;

interface PreviewClaims extends jwt.JwtPayload {
  typ?: string;
  fid?: string;
}

/** 签发一张只读单文件的票 */
export function issuePreviewTicket(fileId: string, sub: string): string {
  return jwt.sign({ typ: 'preview', fid: fileId }, config.jwt.secret, {
    subject: sub,
    expiresIn: PREVIEW_TTL_SECONDS,
  });
}

/**
 * 公开路由，挂在 /api/preview 下 —— 只认票，不认登录头。
 * 必须在 api 前缀之内，否则会掉进 SPA 兜底。
 */
export const previewPublicRouter = express.Router();

previewPublicRouter.get('/:token', (req, res, next) => {
  let claims: PreviewClaims;
  try {
    const decoded = jwt.verify(req.params.token, config.jwt.secret);
    if (typeof decoded === 'string') throw new Error('payload 不是对象');
    claims = decoded as PreviewClaims;
  } catch {
    // 过期与伪造给同一句提示：不告诉试探者票是"真的但过期"还是"假的"
    throw ApiError.unauthorized('预览链接已过期，请重新打开预览');
  }

  if (claims.typ !== 'preview' || typeof claims.fid !== 'string' || !claims.fid) {
    throw ApiError.unauthorized('这不是预览票');
  }

  // 票里的文件可能已被彻底删除，这里会抛 404
  const row = requireFileRow(claims.fid);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  sendStoredFile(res, next, fileAbsPath(row), {
    contentType: row.mime || 'application/octet-stream',
    filename: row.original_name,
    disposition: 'inline',
    // 票是短时的，绝不能让中间层留下副本
    cacheControl: 'no-store',
  });
});
