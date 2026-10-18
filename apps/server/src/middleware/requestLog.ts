/**
 * 请求日志：记录方法、路径、状态码、耗时。
 * /media 出图与 /api/health 降到 debug，避免刷屏。
 */
import type { RequestHandler } from 'express';
import { logger } from '../utils/logger.js';

const QUIET_PREFIXES = ['/media/', '/api/health'];

export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const quiet = QUIET_PREFIXES.some((p) => req.path.startsWith(p));
    const line = `${req.method} ${req.originalUrl} → ${res.statusCode} ${ms.toFixed(1)}ms`;
    const extra = { ip: req.ip, bytes: res.getHeader('content-length') };

    if (res.statusCode >= 500) logger.error(line, extra);
    else if (res.statusCode >= 400) logger.warn(line, extra);
    else if (quiet) logger.debug(line);
    else logger.info(line);
  });

  next();
};
