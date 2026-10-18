/**
 * 鉴权（JWT）
 *
 * 新站只有两种身份，且**没有角色表**：
 *   owner  —— 坞主：.env 的 OWNER_USERNAME。建文稿、建文件夹、审投稿。
 *   member —— 会员：投稿、读公开内容、用分享链接。
 *
 * 判定坞主 = 登录用户名与 OWNER_USERNAME 相等。改 .env 重启即换人，
 * 库里没有角色列可维护，也就没有「提权」这条路可走。
 *
 * 令牌只用来证明"你是谁"（sub）；用户名、等级、状态一律从库里现读，
 * 所以停用账号、改等级立刻生效，旧令牌也无法凭 payload 里的字段提权。
 */
import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { get } from '../db/index.js';
import { config } from '../config.js';
import { ApiError } from '../utils/response.js';

export interface AuthClaims {
  sub: string;
  username: string;
  /** 是否坞主（按 .env 的用户名判定，不看数据库） */
  isOwner: boolean;
  level: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 通过 requireAuth / requireOwner / optionalAuth 注入的登录者 */
      user?: AuthClaims;
    }
  }
}

/** 该用户名是不是坞主 */
export function isOwnerName(username: string): boolean {
  return username === config.owner.username;
}

/** 签发令牌 */
export function signAuthToken(user: { sub: string; username: string; level: number }): {
  token: string;
  expiresIn: string;
} {
  const token = jwt.sign({ username: user.username, level: user.level }, config.jwt.secret, {
    subject: user.sub,
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
  return { token, expiresIn: config.jwt.expiresIn };
}

/** 解析并校验令牌（只取 sub，其余字段一律现读库） */
export function verifyToken(token: string): { sub: string } {
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (typeof payload === 'string' || !payload.sub) throw new Error('payload 不合法');
    return { sub: String(payload.sub) };
  } catch {
    throw ApiError.unauthorized('登录已过期，请重新登录');
  }
}

function bearerToken(req: Request): string | null {
  const header = req.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1]?.trim() || null;
}

/**
 * 令牌只用来证明"你是谁"（sub）；用户名、等级、状态一律从库里现读。
 * 这样刚改的等级、刚停用的账号立刻生效，不必等令牌过期。
 */
function loadClaims(sub: string): AuthClaims {
  const row = get<{ id: string; username: string; level: number; status: string }>(
    'SELECT id, username, level, status FROM users WHERE id = ?',
    sub,
  );
  if (!row) throw ApiError.unauthorized('账号不存在，请重新登录');
  if (row.status === 'disabled') throw ApiError.forbidden('账号已被停用，请联系坞主');
  return {
    sub: row.id,
    username: row.username,
    isOwner: isOwnerName(row.username),
    level: row.level,
  };
}

/** 必须登录（会员或坞主都行）—— 投稿走它 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized();
  req.user = loadClaims(verifyToken(token).sub);
  next();
};

/** 必须是坞主 —— 建文稿、建文件夹、审投稿、发邀请码走它 */
export const requireOwner: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized();
  const claims = loadClaims(verifyToken(token).sub);
  if (!claims.isOwner) throw ApiError.forbidden('只有坞主能做这件事');
  req.user = claims;
  next();
};

/**
 * 可选登录：带了合法令牌就注入身份，没带、非法或账号已停用则匿名放行。
 * 用于「公开内容免登录，但登录后能看到更多（按等级）」的接口。
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req);
  if (token) {
    try {
      req.user = loadClaims(verifyToken(token).sub);
    } catch {
      /* 匿名放行（令牌过期或账号停用都不该让公开接口报错） */
    }
  }
  next();
};
