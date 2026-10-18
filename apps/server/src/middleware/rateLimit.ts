/**
 * 内存限流器（滑动窗口）
 * 说明：单实例部署够用；将来多实例时换成 Redis 计数即可（接口不变）。
 */
import type { RequestHandler } from 'express';
import { ApiError } from '../utils/response.js';

interface Options {
  windowMs: number;
  max: number;
  /** 计数键，默认按 IP；登录接口可按 IP + 用户名 */
  keyFn?: (req: Parameters<RequestHandler>[0]) => string;
  message?: string;
}

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
let sweeper: NodeJS.Timeout | null = null;

function startSweeper(windowMs: number): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
      if (bucket.hits.length === 0) buckets.delete(key);
    }
  }, Math.max(10_000, windowMs));
  // 不阻止进程退出
  sweeper.unref?.();
}

/** 客户端 IP（经 Nginx 反代时依赖 app.set('trust proxy', ...)） */
function clientIp(req: Parameters<RequestHandler>[0]): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function createRateLimiter(opts: Options): RequestHandler {
  const { windowMs, max, keyFn, message } = opts;
  startSweeper(windowMs);

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : clientIp(req);
    const now = Date.now();
    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - bucket.hits[0]!)) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      throw ApiError.tooMany(message ?? `请求过于频繁，请 ${Math.max(1, retryAfter)} 秒后再试`);
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
    next();
  };
}

/** 登录：同 IP + 同用户名 每分钟 N 次 */
export function loginLimiter(max: number, windowSeconds: number): RequestHandler {
  return createRateLimiter({
    windowMs: windowSeconds * 1000,
    max,
    keyFn: (req) => {
      const username = typeof req.body?.username === 'string' ? req.body.username : '';
      return `login:${clientIp(req)}:${username}`;
    },
    message: '登录尝试过于频繁，请稍后再试',
  });
}

/** 分析机接口：同 IP 每分钟 600 次（正常轮询 + 进度上报足够，异常流量会被挡住） */
export function workerLimiter(): RequestHandler {
  return createRateLimiter({
    windowMs: 60_000,
    max: 600,
    keyFn: (req) => `worker:${clientIp(req)}`,
    message: '分析机请求过于频繁',
  });
}

/** 任务创建：同 IP 每小时 30 次（防脚本刷任务） */
export function taskCreateLimiter(): RequestHandler {
  return createRateLimiter({
    windowMs: 3600_000,
    max: 30,
    keyFn: (req) => `task:${clientIp(req)}`,
    message: '创建任务过于频繁，请稍后再试',
  });
}

/**
 * 内部接口（/api/internal/*）：同 IP 每分钟 300 次。
 * 家里那台只有一台机器，正常调用远低于这个量；异常流量直接挡住。
 */
export function internalLimiter(): RequestHandler {
  return createRateLimiter({
    windowMs: 60_000,
    max: 300,
    keyFn: (req) => `internal:${clientIp(req)}`,
    message: '内部接口请求过于频繁',
  });
}

/** 仅供测试：清空计数 */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * 问卷提交：同 IP 每分钟 20 次。
 * 作答者不需要账号，这是唯一能挡住脚本刷答卷的一道门；
 * 正常人填一份要几分钟，20 次/分钟不会误伤，也够连续几轮冒烟跑完。
 */
export function surveySubmitLimiter(): RequestHandler {
  return createRateLimiter({
    windowMs: 60_000,
    max: 20,
    keyFn: (req) => `survey:${clientIp(req)}`,
    message: '提交过于频繁，请稍后再试',
  });
}
