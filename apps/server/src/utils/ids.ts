/**
 * ID / 时间 / 令牌 / 摘要 工具
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

/** 业务 ID：前缀 + 16 位十六进制，例如 file_9f2c1a4b8e3d7a05 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

/** 当前时间（UTC ISO8601，全链路统一） */
export function nowIso(): string {
  return new Date().toISOString();
}

/** N 秒后的时间（UTC ISO8601） */
export function isoAfterSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/** 分享令牌：32 字节随机，base64url，不可枚举 */
export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** 文件 SHA-256（流式计算，避免大文件占内存） */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * 常量时间字符串比较（防时序侧信道），用于 API Key 校验。
 * 长度不同时也要比较一次，避免"长度不同立刻返回"泄漏信息。
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  return crypto.timingSafeEqual(padA, padB) && bufA.length === bufB.length;
}

/** URL 安全的 slug：保留中日韩文字与字母数字，其余转连字符 */
export function slugify(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{Script=Han}\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || `doc-${crypto.randomBytes(4).toString('hex')}`;
}
