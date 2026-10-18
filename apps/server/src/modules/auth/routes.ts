/**
 * 认证路由
 *   POST /api/auth/login     账号密码登录 → JWT（限流；管理员与会员共用）
 *   POST /api/auth/register  邀请码 + 用户名 + 密码 注册（限流）
 *   GET  /api/auth/me        当前登录者（含 role / level）
 *   POST /api/auth/password  修改密码
 */
import express from 'express';
import { config } from '../../config.js';
import { loginLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { ApiError, ok } from '../../utils/response.js';
import { changePassword, findUserById, login, register, toAuthUser } from './service.js';

export const authRouter = express.Router();

authRouter.post(
  '/login',
  loginLimiter(config.rateLimit.loginMax, config.rateLimit.loginWindowSeconds),
  (req, res) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) throw ApiError.badRequest('请输入账号与密码');

    ok(res, login(username, password), '登录成功');
  },
);

authRouter.post(
  '/register',
  loginLimiter(config.rateLimit.loginMax, config.rateLimit.loginWindowSeconds),
  (req, res) => {
    const body = (req.body ?? {}) as { code?: unknown; username?: unknown; password?: unknown; nickname?: unknown };
    const result = register({
      code: typeof body.code === 'string' ? body.code : '',
      username: typeof body.username === 'string' ? body.username : '',
      password: typeof body.password === 'string' ? body.password : '',
      nickname: typeof body.nickname === 'string' ? body.nickname : '',
    });
    ok(res, result, '注册成功', 201);
  },
);

authRouter.get('/me', requireAuth, (req, res) => {
  const user = findUserById(req.user!.sub);
  if (!user) throw ApiError.unauthorized('账号不存在');
  ok(res, toAuthUser(user));
});

authRouter.post('/password', requireAuth, (req, res) => {
  const body = (req.body ?? {}) as { oldPassword?: unknown; newPassword?: unknown };
  const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!oldPassword || !newPassword) throw ApiError.badRequest('请提供 oldPassword 与 newPassword');

  changePassword(req.user!.sub, oldPassword, newPassword);
  ok(res, null, '密码已修改，请重新登录');
});
