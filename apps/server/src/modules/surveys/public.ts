/**
 * 问卷填答路由（**免登录**，凭 token）
 *
 *   GET  /api/q/:token         问卷定义（同时下发访客 cookie）
 *   POST /api/q/:token/submit  提交答卷  { answers: { <questionId>: value } }
 *
 * 为什么要 cookie：坞主可以要求「同一浏览器只交一份」。作答者没有账号，
 * 这是唯一不打扰人的识别方式。cookie 只是一个随机 id，服务端只存它的哈希，
 * 不落明文 IP，也不做浏览器指纹。
 */
import crypto from 'node:crypto';
import express from 'express';
import { ApiError, ok } from '../../utils/response.js';
import { surveySubmitLimiter } from '../../middleware/rateLimit.js';
import { getPublicSurvey, submitResponse } from './service.js';

export const surveyPublicRouter = express.Router();

const VISITOR_COOKIE = 'cjw_vid';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function readCookie(req: express.Request, name: string): string {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

/** 访客标识：优先 cookie；拿不到就退回「IP + UA + 当天」的哈希（弱一点，但比没有强） */
function visitorHash(req: express.Request, vid: string): string {
  const material = vid
    ? `vid:${vid}`
    : `ip:${req.ip ?? 'unknown'}|ua:${req.headers['user-agent'] ?? ''}|day:${new Date().toISOString().slice(0, 10)}`;
  return crypto.createHash('sha256').update(material).digest('hex');
}

surveyPublicRouter.get('/:token', (req, res) => {
  let vid = readCookie(req, VISITOR_COOKIE);
  if (!vid) {
    vid = crypto.randomBytes(16).toString('base64url');
    res.cookie(VISITOR_COOKIE, vid, {
      maxAge: ONE_YEAR_MS,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  }
  const survey = getPublicSurvey(req.params.token);
  ok(res, survey);
});

surveyPublicRouter.post('/:token/submit', surveySubmitLimiter(), (req, res) => {
  const body = (req.body ?? {}) as { answers?: unknown };
  if (!body.answers || typeof body.answers !== 'object') {
    throw ApiError.badRequest('缺少 answers');
  }

  const vid = readCookie(req, VISITOR_COOKIE);
  const result = submitResponse(
    String(req.params.token),
    body.answers,
    visitorHash(req, vid),
    String(req.headers['user-agent'] ?? ''),
  );
  ok(res, result, '已提交，谢谢');
});
