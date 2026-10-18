/**
 * 会员与邀请码（坞主侧）
 *
 * 邀请码：18 位，三组「3 字母 + 3 数字」连写，例 KQZ111TRM802PLU913。
 * 生成时字母表去掉容易看错的 I / O，数字去掉 0；校验时容错空格、连字符与大小写。
 *
 * 旧站的灵石（邀请码初始余额、厘灵石换算、余额账本）随那套体系一并删除；
 * 「管理员」这个概念也没有了 —— 谁是坞主由 .env 的 OWNER_USERNAME 判定。
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { InviteCode, MemberItem } from '@cangjingwu/shared';
import { all, get, run } from '../../db/index.js';
import { newId, nowIso } from '../../utils/ids.js';
import { ApiError } from '../../utils/response.js';
import { isOwnerName } from '../../middleware/auth.js';

/** 字母表：24 个（无 I、O） */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** 数字表：9 个（无 0） */
const DIGITS = '123456789';

/** 生成一个 18 位邀请码 */
export function genInviteCode(): string {
  const group = (): string => {
    let s = '';
    for (let i = 0; i < 3; i += 1) s += LETTERS[crypto.randomInt(LETTERS.length)];
    for (let i = 0; i < 3; i += 1) s += DIGITS[crypto.randomInt(DIGITS.length)];
    return s;
  };
  return `${group()}${group()}${group()}`;
}

/** 规范化用户输入：去掉空格 / 连字符 / 下划线 / 间隔点，统一大写 */
export function normalizeInviteCode(input: string): string {
  return String(input ?? '')
    .replace(/[\s\-_·]/g, '')
    .toUpperCase();
}

/** 形状校验：18 位，三组「3 字母 + 3 数字」 */
export function isValidInviteShape(code: string): boolean {
  return /^(?:[A-Z]{3}\d{3}){3}$/.test(code);
}

interface InviteRow {
  code: string;
  level: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  disabled: number;
  note: string;
  created_at: string;
  updated_at: string;
}

function toInvite(r: InviteRow): InviteCode {
  return {
    code: r.code,
    level: r.level,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    expiresAt: r.expires_at,
    disabled: r.disabled === 1,
    note: r.note,
    createdAt: r.created_at,
  };
}

const clampLevel = (n: unknown, fallback = 1): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(9, Math.max(1, Math.trunc(v)));
};

/** 批量生成邀请码（碰撞自动重试） */
export function createInviteCodes(input: {
  count?: unknown;
  level?: unknown;
  maxUses?: unknown;
  expiresAt?: unknown;
  note?: unknown;
}): InviteCode[] {
  const count = Math.min(50, Math.max(1, Number(input.count) || 1));
  const level = clampLevel(input.level, 1);
  const maxUses = Math.min(1000, Math.max(1, Number(input.maxUses) || 1));
  const note = typeof input.note === 'string' ? input.note.slice(0, 200) : '';
  const expiresAt =
    typeof input.expiresAt === 'string' && input.expiresAt.trim()
      ? new Date(input.expiresAt).toISOString()
      : null;

  const now = nowIso();
  const created: InviteCode[] = [];
  for (let i = 0; i < count; i += 1) {
    // 极少概率撞码，重试几次即可
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = genInviteCode();
      const exists =
        get<{ c: number }>('SELECT COUNT(*) AS c FROM invite_codes WHERE code = ?', code)?.c ?? 0;
      if (exists > 0) continue;
      run(
        `INSERT INTO invite_codes (code, level, max_uses, used_count, expires_at, disabled, note, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?)`,
        code,
        level,
        maxUses,
        expiresAt,
        note,
        now,
        now,
      );
      created.push({
        code,
        level,
        maxUses,
        usedCount: 0,
        expiresAt,
        disabled: false,
        note,
        createdAt: now,
      });
      break;
    }
  }
  if (created.length === 0) throw ApiError.internal('邀请码生成失败，请重试');
  return created;
}

export function listInviteCodes(): InviteCode[] {
  const rows = all<InviteRow>('SELECT * FROM invite_codes ORDER BY created_at DESC, code ASC');
  return rows.map(toInvite);
}

/** 更新邀请码（停用/改等级/改次数/改期限/改备注） */
export function updateInviteCode(code: string, patch: Record<string, unknown>): InviteCode {
  const row = get<InviteRow>('SELECT * FROM invite_codes WHERE code = ?', normalizeInviteCode(code));
  if (!row) throw ApiError.notFound('邀请码不存在');

  const level = patch.level === undefined ? row.level : clampLevel(patch.level, row.level);
  const maxUses =
    patch.maxUses === undefined
      ? row.max_uses
      : Math.min(1000, Math.max(1, Number(patch.maxUses) || row.max_uses));
  const disabled = patch.disabled === undefined ? row.disabled : patch.disabled ? 1 : 0;
  const note = patch.note === undefined ? row.note : String(patch.note).slice(0, 200);
  const expiresAt =
    patch.expiresAt === undefined
      ? row.expires_at
      : patch.expiresAt
        ? new Date(String(patch.expiresAt)).toISOString()
        : null;

  run(
    `UPDATE invite_codes SET level = ?, max_uses = ?, disabled = ?, note = ?, expires_at = ?, updated_at = ?
      WHERE code = ?`,
    level,
    maxUses,
    disabled,
    note,
    expiresAt,
    nowIso(),
    row.code,
  );
  const updated = get<InviteRow>('SELECT * FROM invite_codes WHERE code = ?', row.code)!;
  return toInvite(updated);
}

export function deleteInviteCode(code: string): void {
  const r = run('DELETE FROM invite_codes WHERE code = ?', normalizeInviteCode(code));
  if (r.changes === 0) throw ApiError.notFound('邀请码不存在');
}

/** 一键停用所有「还有剩余次数、且未过期」的码 */
export function disableAllInviteCodes(): number {
  const r = run(
    'UPDATE invite_codes SET disabled = 1, updated_at = ? WHERE disabled = 0 AND used_count < max_uses',
    nowIso(),
  );
  return r.changes;
}

/**
 * 校验并**原子占用**一次使用（在校验完用户名之后、建号之前调用）。
 * 用 `used_count < max_uses` 作为 WHERE 条件，并发下也只有一个请求能成功。
 */
export function consumeInviteCode(rawCode: string): InviteRow {
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteShape(code)) {
    throw ApiError.badRequest('注册码格式不对：应为 18 位（三组「3 个字母 + 3 个数字」）');
  }
  const row = get<InviteRow>('SELECT * FROM invite_codes WHERE code = ?', code);
  if (!row) throw ApiError.badRequest('这个注册码不存在，请核对后重试');
  if (row.disabled === 1) throw ApiError.forbidden('这个注册码已被停用');
  if (row.expires_at && row.expires_at < nowIso()) throw ApiError.forbidden('这个注册码已过期');
  if (row.used_count >= row.max_uses) throw ApiError.forbidden('这个注册码已经用完了');

  const r = run(
    `UPDATE invite_codes SET used_count = used_count + 1, updated_at = ?
      WHERE code = ? AND disabled = 0 AND used_count < max_uses`,
    nowIso(),
    code,
  );
  if (r.changes === 0) throw ApiError.conflict('这个注册码刚刚被用完了，换一个吧');
  return row;
}

/** 记录一次邀请码使用（建号成功后调用） */
export function recordInviteUse(code: string, userId: string): void {
  run(
    'INSERT INTO invite_uses (id, code, user_id, created_at) VALUES (?, ?, ?, ?)',
    newId('use'),
    normalizeInviteCode(code),
    userId,
    nowIso(),
  );
}

// ---------------------------------------------------------------- 会员管理

interface MemberRow {
  id: string;
  username: string;
  level: number;
  status: string;
  nickname: string;
  invite_code: string | null;
  note: string;
  created_at: string;
  last_login_at: string | null;
}

function toMember(r: MemberRow, counts?: { files: number; pending: number }): MemberItem {
  return {
    id: r.id,
    username: r.username,
    nickname: r.nickname,
    isOwner: isOwnerName(r.username),
    level: r.level,
    status: r.status === 'disabled' ? 'disabled' : 'active',
    inviteCode: r.invite_code,
    note: r.note,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    fileCount: counts?.files,
    pendingCount: counts?.pending,
  };
}

/** 每人投了多少、还有多少没审（坞主一眼看清谁在投） */
function uploaderCounts(): Map<string, { files: number; pending: number }> {
  const rows = all<{ uploaded_by: string; files: number; pending: number }>(
    `SELECT uploaded_by,
            COUNT(*) AS files,
            SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM files
      WHERE deleted_at IS NULL AND uploaded_by IS NOT NULL
      GROUP BY uploaded_by`,
  );
  return new Map(rows.map((r) => [r.uploaded_by, { files: r.files, pending: r.pending }]));
}

/** 会员列表（坞主排在最前，便于识别） */
export function listMembers(): MemberItem[] {
  const rows = all<MemberRow>(
    `SELECT id, username, level, status, nickname, invite_code, note, created_at, last_login_at
       FROM users ORDER BY created_at ASC`,
  );
  const counts = uploaderCounts();
  return rows
    .map((r) => toMember(r, counts.get(r.id)))
    .sort((a, b) => (a.isOwner === b.isOwner ? 0 : a.isOwner ? -1 : 1));
}

/** 改等级 / 停用启用 / 改昵称备注 */
export function updateMember(id: string, patch: Record<string, unknown>): MemberItem {
  const row = get<MemberRow>('SELECT * FROM users WHERE id = ?', id);
  if (!row) throw ApiError.notFound('用户不存在');

  const level = patch.level === undefined ? row.level : clampLevel(patch.level, row.level);
  const status =
    patch.status === undefined ? row.status : patch.status === 'disabled' ? 'disabled' : 'active';
  const nickname = patch.nickname === undefined ? row.nickname : String(patch.nickname).slice(0, 40);
  const note = patch.note === undefined ? row.note : String(patch.note).slice(0, 200);

  if (isOwnerName(row.username) && status === 'disabled') {
    throw ApiError.badRequest('不能停用坞主账号');
  }

  run('UPDATE users SET level = ?, status = ?, nickname = ?, note = ? WHERE id = ?', level, status, nickname, note, id);
  return toMember(get<MemberRow>('SELECT * FROM users WHERE id = ?', id)!);
}

/** 删除会员（坞主不可删；他投的稿改成「无归属」而不是跟着消失） */
export function deleteMember(id: string): void {
  const row = get<{ username: string }>('SELECT username FROM users WHERE id = ?', id);
  if (!row) throw ApiError.notFound('用户不存在');
  if (isOwnerName(row.username)) throw ApiError.badRequest('不能删除坞主账号');

  run('UPDATE files SET uploaded_by = NULL WHERE uploaded_by = ?', id);
  run('DELETE FROM users WHERE id = ?', id);
}

/** 重置会员密码（坞主操作，不需要旧密码） */
export function resetMemberPassword(id: string, newPassword: string): void {
  if (String(newPassword).length < 8) throw ApiError.badRequest('新密码至少 8 位');
  const row = get<{ id: string }>('SELECT id FROM users WHERE id = ?', id);
  if (!row) throw ApiError.notFound('用户不存在');
  run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(String(newPassword), 12), id);
}

/** 会员概况（坞主编辑台用）—— 只统计非坞主账号 */
export function memberStats(): {
  total: number;
  active: number;
  disabled: number;
  byLevel: Record<string, number>;
} {
  const rows = all<{ username: string; level: number; status: string }>(
    'SELECT username, level, status FROM users',
  );
  let total = 0;
  let active = 0;
  let disabled = 0;
  const byLevel: Record<string, number> = {};
  for (const r of rows) {
    if (isOwnerName(r.username)) continue;
    total += 1;
    if (r.status === 'disabled') disabled += 1;
    else active += 1;
    byLevel[`LV${r.level}`] = (byLevel[`LV${r.level}`] ?? 0) + 1;
  }
  return { total, active, disabled, byLevel };
}
