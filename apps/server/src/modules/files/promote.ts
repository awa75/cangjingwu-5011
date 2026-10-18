/**
 * 收录即发布：把「已收录的 Markdown / 纯文本投稿」升格成一篇文库文稿。
 *
 * 为什么需要它：文库只列 documents 表，而收录只改 files.review_status ——
 * 结果是投稿被收录之后，在文库首页什么都看不到。这里让 .md / .markdown / .txt
 * 的投稿在放行时自动长成文稿，原文件同时绑成它的附件，
 * 于是「收录」和「文库可见」变成同一件事。
 *
 * 影像（图片/视频/音频）不走这里，它们由 /api/public/media 在文库「影像」区展示。
 */
import fs from 'node:fs';
import type { FileItem } from '@cangjingwu/shared';
import { logger } from '../../utils/logger.js';
import { all } from '../../db/index.js';
import { bindDocumentFile, createDocument, findDocumentIdByFile } from '../documents/service.js';
import { fileAbsPath, findFileRow, toFileItem } from './service.js';

/** 能被当成「文稿正文」读出来的扩展名 */
const TEXT_EXTS = new Set(['md', 'markdown', 'txt', 'text']);

/** 正文上限：再大就不像文稿了；截断并注明，完整内容仍在附件里 */
const MAX_CHARS = 2 * 1024 * 1024;

export type PromotedDocument = { id: string; slug: string; title: string };

/**
 * 放行一个文件之后调用。不是文本类、或已经绑过文稿时返回 null（幂等）。
 * 读正文失败不抛错：建一篇空文稿也比「收录了但文库没有」强，坞主可以再编辑。
 */
export function promoteTextFileToDocument(file: FileItem): PromotedDocument | null {
  if (file.kind !== 'doc') return null;
  const ext = String(file.ext || '')
    .toLowerCase()
    .replace(/^\./, '');
  if (!TEXT_EXTS.has(ext)) return null;

  // 已经绑过文稿就别再建一篇 —— 重复点「收录」不该生出副本
  if (findDocumentIdByFile(file.id)) return null;

  const row = findFileRow(file.id);
  if (!row) return null;

  let content = '';
  try {
    const raw = fs.readFileSync(fileAbsPath(row), 'utf8');
    content =
      raw.length > MAX_CHARS
        ? `${raw.slice(0, MAX_CHARS)}\n\n---\n\n（原文过长，此处已截断，完整内容见附件）`
        : raw;
  } catch (err) {
    logger.warn('读投稿正文失败，改为建空文稿', {
      fileId: file.id,
      error: (err as Error).message,
    });
  }

  // 标题取文件名去扩展名；slug 交给 createDocument 去重
  const title = file.originalName.replace(/\.[^.]+$/, '').trim() || '未命名文稿';
  const doc = createDocument({ title, contentMd: content, visible: true, minLevel: 1 });
  bindDocumentFile(doc.id, file.id);

  logger.info('投稿已升格为文稿', { fileId: file.id, documentId: doc.id, slug: doc.slug });
  return { id: doc.id, slug: doc.slug, title: doc.title };
}

/**
 * 启动时回填：补上「在升格逻辑存在之前就已经被收录」的那些文本投稿。
 *
 * 没有它，早先收录的 .md 永远是「已收录但文库看不到」—— 用户踩的就是这个。
 * 幂等：只挑 approved、kind='doc'、且还没绑过任何文稿的文件。
 */
export function promoteApprovedTextFiles(): number {
  const rows = all<{ id: string }>(
    `SELECT f.id FROM files f
      WHERE f.deleted_at IS NULL
        AND f.review_status = 'approved'
        AND f.kind = 'doc'
        AND NOT EXISTS (SELECT 1 FROM document_files df WHERE df.file_id = f.id)`,
  );
  let promoted = 0;
  for (const r of rows) {
    const row = findFileRow(r.id);
    if (!row) continue;
    try {
      if (promoteTextFileToDocument(toFileItem(row))) promoted += 1;
    } catch (err) {
      logger.warn('回填升格失败', { fileId: r.id, error: (err as Error).message });
    }
  }
  return promoted;
}
