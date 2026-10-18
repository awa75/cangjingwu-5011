/**
 * 公开读取路由（**免登录**）：文库、文稿、绑定文件、站点文案
 *
 * 可见性口径（四层，缺一不可）：
 *   ① 收录状态：文件必须 review_status='approved' 才会出现在这里；
 *   ② 发布状态：文稿的 visible、文件的 visibility；
 *   ③ 内容等级：每类内容有 min_level（1..9），低于它的访客整条看不到；
 *      匿名按 0 级、会员按自己等级、坞主按 9 级（见 utils/levels.ts）；
 *   ④ 文件夹继承：夹内内容也受所属文件夹的 min_level 约束。
 */
import express from 'express';
import type { FileItem, FileKind } from '@cangjingwu/shared';
import { ApiError, ok, parsePaging } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import { sanitizeFilename } from '../../utils/paths.js';
import { streamZip } from '../../utils/zip.js';
import { optionalAuth } from '../../middleware/auth.js';
import { contentLevel, visibleTo } from '../../utils/levels.js';
import { fileAbsPath, findFileRow, listPublicMedia } from '../files/service.js';
import { listCollections } from '../collections/service.js';
import {
  downloadableDocumentFiles,
  findDocumentBySlug,
  listDocumentFiles,
  listDocuments,
  toDocumentItem,
} from '../documents/service.js';
import { getPublicSettings } from '../settings/service.js';

export const publicRouter = express.Router();

/** 当前查看者能看到的等级：匿名 0 / 会员按自己 / 坞主 9 */
function levelOf(req: express.Request): number {
  return contentLevel(req.user);
}

/** 文件夹 id → 最低等级（夹内内容继承它） */
function collectionLevels(): Map<string, number> {
  return new Map(listCollections({ visibleOnly: false }).map((c) => [c.id, c.minLevel]));
}

/** 文稿是否对查看者可见：自身等级 + 所属文件夹等级 */
function keepDoc(
  doc: { minLevel: number; collectionId: string | null },
  level: number,
  colLevel: Map<string, number>,
): boolean {
  if (!visibleTo(doc.minLevel, level)) return false;
  if (doc.collectionId && !visibleTo(colLevel.get(doc.collectionId), level)) return false;
  return true;
}

/** 文稿附件是否可对外：必须已被坞主收录，且等级够 */
function keepBoundFile(file: FileItem | null, level: number): boolean {
  if (!file) return false;
  if (file.reviewStatus !== 'approved') return false;
  return visibleTo(file.minLevel, level);
}

/** GET /api/public/site —— 站点文案与设置 */
publicRouter.get('/site', (_req, res) => {
  ok(res, getPublicSettings());
});

/** GET /api/public/collections —— 文库文件夹列表（含"未归档"计数） */
publicRouter.get('/collections', optionalAuth, (req, res) => {
  const level = levelOf(req);
  const colLevel = collectionLevels();
  // 前台要把卷首说明直接显示在文件夹横条里（"不隐藏"），所以列表就带上 descriptionMd
  const items = listCollections({ visibleOnly: true, kind: 'library', withDescription: true }).filter(
    (c) => visibleTo(c.minLevel, level),
  );
  const unassigned = listDocuments({ visibleOnly: true, withContent: false }).filter(
    (d) => !d.collectionId && keepDoc(d, level, colLevel),
  ).length;
  ok(res, { items, total: items.length, unassigned, kind: 'library' });
});

/** GET /api/public/documents —— 文库列表（不含正文） */
publicRouter.get('/documents', optionalAuth, (req, res) => {
  const level = levelOf(req);
  const colLevel = collectionLevels();
  const items = listDocuments({ visibleOnly: true, withContent: false }).filter((d) =>
    keepDoc(d, level, colLevel),
  );
  ok(res, { items, total: items.length });
});

/**
 * GET /api/public/media —— 文库「影像」区
 *
 * 只出已收录（approved）、公开（public）、等级够的图片 / 视频 / 音频。
 * 这不是旧站的「作品集」栏目，而是文库的一部分：收录即发布。
 */
publicRouter.get('/media', optionalAuth, (req, res) => {
  const level = levelOf(req);
  const paging = parsePaging(req.query as Record<string, unknown>);
  const kind = typeof req.query.kind === 'string' ? (req.query.kind as FileKind) : undefined;
  const { items, total } = listPublicMedia({
    level,
    offset: paging.offset,
    limit: paging.limit,
    kind,
  });
  ok(res, { items, total });
});

/** GET /api/public/documents/:slug/files —— 这篇文稿绑定了哪些文件（文库小方块用） */
publicRouter.get('/documents/:slug/files', optionalAuth, (req, res) => {
  const level = levelOf(req);
  const colLevel = collectionLevels();
  const row = findDocumentBySlug(String(req.params.slug));
  if (!row || row.visible !== 1) throw ApiError.notFound('文稿不存在或未公开');
  if (!visibleTo(row.min_level, level)) throw ApiError.notFound('文稿不存在或未公开');
  if (row.collection_id && !visibleTo(colLevel.get(row.collection_id), level)) {
    throw ApiError.notFound('文稿不存在或未公开');
  }
  const items = listDocumentFiles(row.id).filter((it) => keepBoundFile(it.file, level));
  ok(res, { items, total: items.length });
});

/**
 * GET /api/public/documents/:slug/download —— 把该文稿绑定的全部文件打包成 zip 下载
 * 用流式 ZIP（不压缩）：素材多半是已压过的图片/音视频，再压既费 CPU 又几乎不省体积；
 * 而且流式不吃内存，几百 MB 的素材也不会把服务器顶爆。
 */
publicRouter.get('/documents/:slug/download', optionalAuth, async (req, res, next) => {
  try {
    const level = levelOf(req);
    const row = findDocumentBySlug(String(req.params.slug));
    if (!row || row.visible !== 1) throw ApiError.notFound('文稿不存在或未公开');
    if (!visibleTo(row.min_level, level)) throw ApiError.notFound('文稿不存在或未公开');

    const bound = downloadableDocumentFiles(row.id).filter((it) => keepBoundFile(it.file, level));
    if (bound.length === 0) throw ApiError.notFound('这篇文稿还没有可下载的附件');

    const used = new Set<string>();
    const entries = bound.map((item, index) => {
      const file = item.file!;
      const fileRow = findFileRow(file.id);
      if (!fileRow) throw ApiError.notFound('绑定文件已被删除');
      let name = sanitizeFilename(file.originalName) || `file-${index + 1}`;
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        name = `${base}-${index + 1}${ext}`;
      }
      used.add(name);
      return { name, absPath: fileAbsPath(fileRow), size: file.size, mtime: new Date(file.createdAt) };
    });

    const zipName = `${row.slug}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${zipName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    await streamZip(res, entries);
    res.end();
  } catch (err) {
    // 头已经发出去了就没法再改状态码，只能掐断连接，让客户端看出下载失败
    if (res.headersSent) {
      res.destroy();
      logger.warn('打包下载中断', { slug: req.params.slug, error: (err as Error).message });
      return;
    }
    next(err);
  }
});

/** GET /api/public/documents/:slug —— 按 slug 读单篇（含正文） */
publicRouter.get('/documents/:slug', optionalAuth, (req, res) => {
  const level = levelOf(req);
  const colLevel = collectionLevels();
  const row = findDocumentBySlug(String(req.params.slug));
  if (!row || row.visible !== 1) throw ApiError.notFound('文稿不存在或未公开');
  if (!visibleTo(row.min_level, level)) throw ApiError.notFound('文稿不存在或未公开');
  if (row.collection_id && !visibleTo(colLevel.get(row.collection_id), level)) {
    throw ApiError.notFound('文稿不存在或未公开');
  }
  ok(res, toDocumentItem(row));
});
