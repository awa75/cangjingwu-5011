/**
 * 分享令牌：生成、列出、撤销、校验
 * 安全模型：token 是唯一凭证（32 字节随机、不可枚举），可设过期时间与访问次数上限，可随时撤销。
 */
import type { ShareItem, ShareResolved, ShareTargetType } from '@cangjingwu/shared';
import { all, get, run } from '../../db/index.js';
import { config } from '../../config.js';
import { newId, newToken, nowIso } from '../../utils/ids.js';
import { ApiError } from '../../utils/response.js';
import { findFileRow, toFileItem } from '../files/service.js';
import { findDocumentById, toDocumentItem } from '../documents/service.js';

export interface ShareRow {
  id: string;
  token: string;
  target_type: ShareTargetType;
  target_id: string;
  expires_at: string | null;
  max_views: number | null;
  views: number;
  revoked: number;
  created_at: string;
}

/** 分享地址前缀（生产为 PUBLIC_BASE_URL） */
export function shareUrl(token: string): string {
  return `${config.publicBaseUrl}/s/${token}`;
}

function targetTitle(type: ShareTargetType, targetId: string): string {
  if (type === 'file') {
    const f = findFileRow(targetId, true);
    return f ? f.original_name : '(文件已删除)';
  }
  const d = findDocumentById(targetId);
  return d ? d.title : '(文档已删除)';
}

function isExpired(row: ShareRow): boolean {
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() <= Date.now();
}

function toShareItem(row: ShareRow): ShareItem {
  return {
    id: row.id,
    token: row.token,
    url: shareUrl(row.token),
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: targetTitle(row.target_type, row.target_id),
    expiresAt: row.expires_at,
    maxViews: row.max_views,
    views: row.views,
    revoked: row.revoked === 1,
    createdAt: row.created_at,
    expired: isExpired(row),
  };
}

/** 校验分享目标存在 */
function assertTargetExists(type: ShareTargetType, targetId: string): void {
  if (type === 'file') {
    if (!findFileRow(targetId, true)) throw ApiError.notFound('要分享的文件不存在');
    return;
  }
  if (!findDocumentById(targetId)) throw ApiError.notFound('要分享的文档不存在');
}

export function createShare(input: {
  targetType: ShareTargetType;
  targetId: string;
  expiresInHours?: number | null;
  maxViews?: number | null;
}): ShareItem {
  const { targetType, targetId } = input;
  if (targetType !== 'file' && targetType !== 'document') {
    throw ApiError.badRequest('targetType 只能是 file 或 document');
  }
  assertTargetExists(targetType, targetId);

  let expiresAt: string | null = null;
  if (input.expiresInHours !== undefined && input.expiresInHours !== null) {
    const hours = Number(input.expiresInHours);
    if (!Number.isFinite(hours) || hours <= 0) throw ApiError.badRequest('expiresInHours 必须为正数');
    if (hours > 24 * 365) throw ApiError.badRequest('过期时间不能超过 1 年');
    expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  }

  let maxViews: number | null = null;
  if (input.maxViews !== undefined && input.maxViews !== null) {
    const n = Number(input.maxViews);
    if (!Number.isFinite(n) || n <= 0) throw ApiError.badRequest('maxViews 必须为正整数');
    maxViews = Math.trunc(n);
  }

  const id = newId('share');
  run(
    `INSERT INTO shares (id, token, target_type, target_id, expires_at, max_views, views, revoked, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    id,
    newToken(),
    targetType,
    targetId,
    expiresAt,
    maxViews,
    nowIso(),
  );

  return toShareItem(get<ShareRow>('SELECT * FROM shares WHERE id = ?', id)!);
}

export function listShares(): ShareItem[] {
  const rows = all<ShareRow>('SELECT * FROM shares ORDER BY created_at DESC');
  return rows.map(toShareItem);
}

export function revokeShare(id: string): void {
  const row = get<ShareRow>('SELECT * FROM shares WHERE id = ?', id);
  if (!row) throw ApiError.notFound('分享记录不存在');
  run('UPDATE shares SET revoked = 1 WHERE id = ?', id);
}

/** 按 token 取分享记录并做可用性校验（撤销 / 过期 / 次数用尽） */
export function requireUsableShare(token: string): ShareRow {
  if (!token || token.length < 16) throw ApiError.notFound('分享链接无效');
  const row = get<ShareRow>('SELECT * FROM shares WHERE token = ?', token);
  if (!row) throw ApiError.notFound('分享链接不存在或已被删除');
  if (row.revoked === 1) throw new ApiError(410, '该分享已被撤回');
  if (isExpired(row)) throw new ApiError(410, '该分享已过期');
  if (row.max_views !== null && row.views >= row.max_views) {
    throw new ApiError(410, '该分享的访问次数已用尽');
  }
  return row;
}

/** 记一次访问 */
export function countShareView(row: ShareRow): void {
  run('UPDATE shares SET views = views + 1 WHERE id = ?', row.id);
  row.views += 1;
}

/** 解析分享内容（供免登录页面使用） */
export function resolveShare(token: string, opts: { countView: boolean }): ShareResolved {
  const row = requireUsableShare(token);
  if (opts.countView) countShareView(row);

  const base: ShareResolved = {
    token: row.token,
    targetType: row.target_type,
    title: targetTitle(row.target_type, row.target_id),
    expiresAt: row.expires_at,
    remainingViews: row.max_views === null ? null : Math.max(0, row.max_views - row.views),
  };

  if (row.target_type === 'file') {
    const file = findFileRow(row.target_id, true);
    if (!file) throw ApiError.notFound('分享的文件已被删除');
    base.file = toFileItem(file);
    base.title = file.original_name;
    return base;
  }

  const doc = findDocumentById(row.target_id);
  if (!doc) throw ApiError.notFound('分享的文档已被删除');
  base.document = toDocumentItem(doc);
  base.title = doc.title;
  return base;
}

/** 取分享记录（不过期校验，用于 /raw 二次校验） */
export function findShareById(id: string): ShareRow | undefined {
  return get<ShareRow>('SELECT * FROM shares WHERE id = ?', id);
}
