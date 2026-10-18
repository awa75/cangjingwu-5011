/**
 * 会员与邀请码：坞主接口（挂在 /api/owner 下）
 *   GET    /api/owner/codes                  邀请码列表
 *   POST   /api/owner/codes                  批量生成 { count, level, maxUses, expiresAt, note }
 *   PATCH  /api/owner/codes/:code            改等级/次数/期限/停用
 *   DELETE /api/owner/codes/:code            删除
 *   POST   /api/owner/codes/disable-all      一键停用所有未用尽的码
 *   GET    /api/owner/members                会员列表（含投稿数与待审数）
 *   PATCH  /api/owner/members/:id            改等级/状态/昵称/备注
 *   POST   /api/owner/members/:id/password   重置会员密码
 *   DELETE /api/owner/members/:id            删除会员
 *   GET    /api/owner/members/stats          会员概况
 *
 * 旧站的「会员详情（灵石/计价/绑定/人格/宠物/记忆/流水）」随那套体系一并删除。
 */
import express from 'express';
import { requireOwner } from '../../middleware/auth.js';
import { ok } from '../../utils/response.js';
import {
  createInviteCodes,
  deleteInviteCode,
  deleteMember,
  disableAllInviteCodes,
  listInviteCodes,
  listMembers,
  memberStats,
  resetMemberPassword,
  updateInviteCode,
  updateMember,
} from './service.js';

export const membersOwnerRouter = express.Router();
membersOwnerRouter.use(requireOwner);

membersOwnerRouter.get('/codes', (_req, res) => {
  ok(res, { items: listInviteCodes() });
});

membersOwnerRouter.post('/codes', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const items = createInviteCodes(body);
  ok(res, { items }, `已生成 ${items.length} 个邀请码`, 201);
});

membersOwnerRouter.post('/codes/disable-all', (_req, res) => {
  ok(res, { disabled: disableAllInviteCodes() }, '已停用未用尽的邀请码');
});

membersOwnerRouter.patch('/codes/:code', (req, res) => {
  ok(res, updateInviteCode(req.params.code, (req.body ?? {}) as Record<string, unknown>), '已保存');
});

membersOwnerRouter.delete('/codes/:code', (req, res) => {
  deleteInviteCode(req.params.code);
  ok(res, null, '已删除');
});

membersOwnerRouter.get('/members/stats', (_req, res) => {
  ok(res, memberStats());
});

membersOwnerRouter.get('/members', (_req, res) => {
  ok(res, { items: listMembers() });
});

membersOwnerRouter.patch('/members/:id', (req, res) => {
  ok(res, updateMember(req.params.id, (req.body ?? {}) as Record<string, unknown>), '已保存');
});

membersOwnerRouter.post('/members/:id/password', (req, res) => {
  const body = (req.body ?? {}) as { password?: unknown };
  resetMemberPassword(req.params.id, String(body.password ?? ''));
  ok(res, null, '密码已重置');
});

membersOwnerRouter.delete('/members/:id', (req, res) => {
  deleteMember(req.params.id);
  ok(res, null, '已删除');
});
