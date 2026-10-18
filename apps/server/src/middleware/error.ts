/**
 * 统一错误处理：所有异常最终都变成 { code, message, data:null }
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { logError } from '../utils/logger.js';
import { ApiError, fail } from '../utils/response.js';

/** 兜底 404 */
export const notFoundHandler: RequestHandler = (req, res) => {
  fail(res, 404, `接口不存在：${req.method} ${req.path}`);
};

const MAX_MB = Math.round(config.upload.maxBytes / 1024 / 1024);

/** 统一异常出口（必须放在所有路由之后注册，且保留 4 个参数） */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // 1) multer 上传错误
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      fail(res, 413, `单个文件不能超过 ${MAX_MB}MB`);
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      fail(res, 400, `文件数量超出限制（最多 ${config.upload.maxFiles} 个）`);
      return;
    }
    fail(res, 400, `上传失败：${err.message}`);
    return;
  }

  // 2) 业务异常
  if (err instanceof ApiError) {
    fail(res, err.code, err.message);
    return;
  }

  // 3) 请求体 JSON 解析失败
  if (err instanceof SyntaxError && 'body' in err) {
    fail(res, 400, '请求体不是合法 JSON');
    return;
  }

  // 4) 未知异常：记录堆栈，对外只给安全信息
  logError('未处理的异常', err, { method: req.method, path: req.originalUrl });
  const detail = (err as Error)?.message ?? String(err);
  fail(res, 500, config.isProd ? '服务器内部错误' : `服务器内部错误：${detail}`);
};
