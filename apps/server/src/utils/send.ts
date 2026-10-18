/**
 * 统一的"发送已存储文件"助手
 *
 * 为什么需要它：
 * Express 底层的 send 模块默认 `dotfiles: 'ignore'`，任何**路径段以点开头**的文件都会被拒绝
 * 发送（哪怕它只是被放在 /opt/.data/ 或某个 .verify/ 目录下）。我们的存储目录由
 * DATA_DIR / STORAGE_DIR 决定，管理员完全可能把它放在带点的路径里，所以这里强制
 * `dotfiles: 'allow'`。
 *
 * 同时把 sendFile 的错误收敛成明确的 404，而不是让整个请求炸成 500。
 */
import type { NextFunction, Response } from 'express';

export interface SendStoredFileOptions {
  /** 显式指定 Content-Type；不传则交给 send 按扩展名推断 */
  contentType?: string;
  /** 展示用文件名（会自动做 RFC5987 编码，支持中文名） */
  filename?: string;
  /** inline = 浏览器内直接打开；attachment = 触发下载 */
  disposition?: 'inline' | 'attachment';
  /** 不传则用 send 的默认值 */
  cacheControl?: string;
}

export function sendStoredFile(
  res: Response,
  next: NextFunction,
  absPath: string,
  opts: SendStoredFileOptions = {},
): void {
  const headers: Record<string, string> = {};
  if (opts.contentType) headers['Content-Type'] = opts.contentType;
  if (opts.filename) {
    headers['Content-Disposition'] =
      `${opts.disposition ?? 'inline'}; filename*=UTF-8''${encodeURIComponent(opts.filename)}`;
  }
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl;

  res.sendFile(
    absPath,
    { dotfiles: 'allow', headers },
    (err) => {
      if (!err) return;
      if (res.headersSent) return;

      const code = (err as NodeJS.ErrnoException).code;
      // 数据库里有记录但磁盘上文件没了（被手工删除/磁盘迁移）→ 明确 404
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') {
        res.status(404).json({ code: 404, message: '文件已不存在或不可读', data: null });
        return;
      }
      next(err);
    },
  );
}
