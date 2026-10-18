/**
 * 认证：登录、注册（邀请码）、当前用户、改密
 *
 * 坞主与会员共用一套登录；身份由 .env 的 OWNER_USERNAME 判定，users 表没有角色列。
 */
import bcrypt from 'bcryptjs';
import type { AuthUser, LoginResult, RegisterInput } from '@cangjingwu/shared';
import { get, run, tx } from '../../db/index.js';
import { newId, nowIso } from '../../utils/ids.js';
import { ApiError } from '../../utils/response.js';
import { isOwnerName, signAuthToken } from '../../middleware/auth.js';
import { consumeInviteCode, recordInviteUse } from '../members/service.js';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  level: number;
  status: string;
  nickname: string;
  invite_code: string | null;
  note: string;
  created_at: string;
  last_login_at: string | null;
}

export function findUserByName(username: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE username = ?', username);
}

export function findUserById(id: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    isOwner: isOwnerName(row.username),
    level: row.level,
    nickname: row.nickname || undefined,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function issue(row: UserRow): LoginResult {
  const { token, expiresIn } = signAuthToken({
    sub: row.id,
    username: row.username,
    level: row.level,
  });
  return { token, expiresIn, user: toAuthUser(row) };
}

/** 登录：账号或密码错误统一提示，避免枚举账号 */
export function login(username: string, password: string): LoginResult {
  const user = findUserByName(username);
  if (!user) throw ApiError.unauthorized('账号或密码错误');
  if (!bcrypt.compareSync(password, user.password_hash)) {
    throw ApiError.unauthorized('账号或密码错误');
  }
  if (user.status === 'disabled') {
    throw ApiError.forbidden('账号已被停用，请联系坞主');
  }

  const now = nowIso();
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now, user.id);
  return issue({ ...user, last_login_at: now });
}

/**
 * 注册：邀请码 + 用户名 + 密码。
 * 等级由邀请码决定；邀请码的占用是原子的（并发下不会超发）。
 */
export function register(input: RegisterInput): LoginResult {
  const username = String(input.username ?? '').trim();
  const password = String(input.password ?? '');
  const nickname = String(input.nickname ?? '').trim().slice(0, 40);

  if (!/^[\w\u4e00-\u9fa5-]{2,24}$/.test(username)) {
    throw ApiError.badRequest('用户名 2–24 位，可用中英文、数字、下划线、连字符');
  }
  if (password.length < 8) throw ApiError.badRequest('密码至少 8 位');
  if (findUserByName(username)) throw ApiError.conflict('这个用户名已经被占用了');

  // 先占位（失败会抛出明确的 400/403/409），再建号
  const invite = consumeInviteCode(String(input.code ?? ''));
  const now = nowIso();
  const id = newId('user');

  try {
    tx(() => {
      run(
        `INSERT INTO users
           (id, username, password_hash, level, status, nickname, invite_code, note, created_at, last_login_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, '', ?, ?)`,
        id,
        username,
        bcrypt.hashSync(password, 12),
        invite.level,
        nickname,
        invite.code,
        now,
        now,
      );
      recordInviteUse(invite.code, id);
    });
  } catch (err) {
    // 建号失败就把占用的次数还回去，别白吃一个码
    run(
      'UPDATE invite_codes SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END, updated_at = ? WHERE code = ?',
      nowIso(),
      invite.code,
    );
    throw err;
  }

  const created = findUserById(id);
  if (!created) throw ApiError.internal('注册失败，请重试');
  return issue(created);
}

/** 改密：必须校验旧密码 */
export function changePassword(userId: string, oldPassword: string, newPassword: string): void {
  const user = findUserById(userId);
  if (!user) throw ApiError.unauthorized('登录状态异常，请重新登录');
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    throw ApiError.badRequest('原密码不正确');
  }
  if (newPassword.length < 8) throw ApiError.badRequest('新密码至少 8 位');
  if (oldPassword === newPassword) throw ApiError.badRequest('新密码不能与原密码相同');

  run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(newPassword, 12), userId);
}
