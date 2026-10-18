/**
 * 统一响应格式：{ code, message, data }
 * 成功 code=0；失败 code 与 HTTP 状态一致（400/401/403/404/409/413/429/500），前端一次判断即可。
 */
import type { Response } from 'express';

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T | null;
}

/** 业务异常：抛到中间件统一转成响应 */
export class ApiError extends Error {
  readonly code: number;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    // 业务 code 与 HTTP 状态一一对应；500 以上不额外映射
    this.httpStatus = code >= 400 && code < 600 ? code : 500;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = '未登录或登录已过期'): ApiError {
    return new ApiError(401, message);
  }
  static forbidden(message = '没有权限'): ApiError {
    return new ApiError(403, message);
  }
  static notFound(message = '资源不存在'): ApiError {
    return new ApiError(404, message);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }
  static tooLarge(message: string): ApiError {
    return new ApiError(413, message);
  }
  static tooMany(message = '请求过于频繁，请稍后再试'): ApiError {
    return new ApiError(429, message);
  }
  /** 422：请求本身合法，但内容没法用（例如模型两次都没给出合规的图纸） */
  static unprocessable(message: string, details?: unknown): ApiError {
    return new ApiError(422, message, details);
  }
  static internal(message = '服务器内部错误'): ApiError {
    return new ApiError(500, message);
  }
}

/** 成功响应 */
export function ok<T>(res: Response, data: T, message = 'ok', status = 200): void {
  const body: ApiEnvelope<T> = { code: 0, message, data: data ?? null };
  res.status(status).json(body);
}

/** 失败响应（一般不用直接调用，交给 errorHandler） */
export function fail(res: Response, code: number, message: string): void {
  const status = code >= 400 && code < 600 ? code : 500;
  const body: ApiEnvelope<null> = { code, message, data: null };
  res.status(status).json(body);
}

/** 分页参数解析：page 从 1 开始，pageSize 上限 100 */
export function parsePaging(query: Record<string, unknown>, defaultSize = 24) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const rawSize = Number.parseInt(String(query.pageSize ?? defaultSize), 10) || defaultSize;
  const pageSize = Math.min(100, Math.max(1, rawSize));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}
