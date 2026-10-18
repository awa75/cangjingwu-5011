/**
 * Markdown 文稿模块
 *
 * 文稿可归入「文库文件夹」（collections.kind='library'），并可绑定若干已收录文件
 * （document_files），供文库条目「下载所有文件」打包下载 —— 影像即由此成为文稿附件。
 */
import type { DocumentFileItem, DocumentItem } from '@cangjingwu/shared';
import { all, get, run, tx } from '../../db/index.js';
import { newId, nowIso, slugify } from '../../utils/ids.js';
import { ApiError } from '../../utils/response.js';
import { findFileRow, toFileItem, updateFile } from '../files/service.js';

import { clampMinLevel } from '../../utils/levels.js';

export interface DocumentRow {
  id: string;
  slug: string;
  title: string;
  content_md: string;
  pinned: number;
  visible: number;
  /** 最低等级（1..9） */
  min_level: number;
  collection_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 某篇文稿绑定了几个文件 */
export function countDocumentFiles(documentId: string): number {
  return get<{ c: number }>('SELECT COUNT(*) AS c FROM document_files WHERE document_id = ?', documentId)?.c ?? 0;
}

/** 一次把所有文稿的绑定文件数查出来，避免列表页 N+1 */
function fileCountMap(): Map<string, number> {
  const rows = all<{ document_id: string; c: number }>(
    'SELECT document_id, COUNT(*) AS c FROM document_files GROUP BY document_id',
  );
  return new Map(rows.map((r) => [r.document_id, r.c]));
}

export function toDocumentItem(
  row: DocumentRow,
  withContent = true,
  fileCount = countDocumentFiles(row.id),
): DocumentItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    contentMd: withContent ? row.content_md : '',
    pinned: row.pinned === 1,
    visible: row.visible === 1,
    minLevel: row.min_level,
    collectionId: row.collection_id ?? null,
    sortOrder: row.sort_order,
    fileCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    excerpt: withContent ? undefined : makeExcerpt(row.content_md),
  };
}

/** 列表用摘要：去掉 Markdown 标记，取前 120 字 */
function makeExcerpt(md: string, max = 120): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[>#\-\*\d.\s]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

export function findDocumentById(id: string): DocumentRow | undefined {
  return get<DocumentRow>('SELECT * FROM documents WHERE id = ?', id);
}

export function findDocumentBySlug(slug: string): DocumentRow | undefined {
  return get<DocumentRow>('SELECT * FROM documents WHERE slug = ?', slug);
}

export function requireDocument(id: string): DocumentRow {
  const row = findDocumentById(id);
  if (!row) throw ApiError.notFound('文档不存在');
  return row;
}

/**
 * 列表：排序优先（坞主拖拽的结果）→ 置顶 → 更新时间倒序
 * 文库页把同一文件夹的文稿按这个顺序「圈」在一起展示。
 */
export function listDocuments(opts: { visibleOnly?: boolean; withContent?: boolean } = {}): DocumentItem[] {
  const where = opts.visibleOnly ? 'WHERE visible = 1' : '';
  const rows = all<DocumentRow>(
    `SELECT * FROM documents ${where} ORDER BY sort_order ASC, pinned DESC, updated_at DESC`,
  );
  const counts = fileCountMap();
  return rows.map((r) => toDocumentItem(r, opts.withContent ?? false, counts.get(r.id) ?? 0));
}

/** slug 唯一化：冲突时追加随机后缀 */
function uniqueSlug(base: string, excludeId?: string): string {
  let slug = slugify(base);
  for (let i = 0; i < 20; i += 1) {
    const row = get<{ id: string }>('SELECT id FROM documents WHERE slug = ?', slug);
    if (!row || row.id === excludeId) return slug;
    slug = `${slugify(base)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${slugify(base)}-${Date.now().toString(36)}`;
}

export function createDocument(input: {
  title: string;
  contentMd?: string;
  slug?: string;
  pinned?: boolean;
  visible?: boolean;
  /** 最低等级 1..9（1 = 所有人可见） */
  minLevel?: number;
}): DocumentItem {
  const title = input.title.trim();
  if (!title) throw ApiError.badRequest('标题不能为空');

  const now = nowIso();
  const id = newId('doc');
  run(
    `INSERT INTO documents (id, slug, title, content_md, pinned, visible, min_level, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    uniqueSlug(input.slug?.trim() || title),
    title,
    input.contentMd ?? '',
    input.pinned ? 1 : 0,
    input.visible === false ? 0 : 1,
    clampMinLevel(input.minLevel ?? 1),
    now,
    now,
  );
  return toDocumentItem(requireDocument(id));
}

export function updateDocument(
  id: string,
  patch: {
    title?: string;
    contentMd?: string;
    slug?: string;
    pinned?: boolean;
    visible?: boolean;
    /** 归入文库文件夹；null = 移出到"未归档" */
    collectionId?: string | null;
    sortOrder?: number;
    /** 最低等级 1..9 */
    minLevel?: number;
  },
): DocumentItem {
  const row = requireDocument(id);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw ApiError.badRequest('标题不能为空');
    sets.push('title = ?');
    params.push(title);
  }
  if (patch.contentMd !== undefined) {
    sets.push('content_md = ?');
    params.push(patch.contentMd);
  }
  if (patch.slug !== undefined && patch.slug.trim()) {
    sets.push('slug = ?');
    params.push(uniqueSlug(patch.slug.trim(), id));
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned = ?');
    params.push(patch.pinned ? 1 : 0);
  }
  if (patch.visible !== undefined) {
    sets.push('visible = ?');
    params.push(patch.visible ? 1 : 0);
  }
  if (patch.minLevel !== undefined) {
    sets.push('min_level = ?');
    params.push(clampMinLevel(patch.minLevel));
  }
  if (patch.collectionId !== undefined) {
    const cid = patch.collectionId === null || patch.collectionId === '' ? null : String(patch.collectionId);
    if (cid) assertLibraryFolder(cid);
    sets.push('collection_id = ?');
    params.push(cid);
  }
  if (patch.sortOrder !== undefined) {
    const n = Number(patch.sortOrder);
    if (!Number.isFinite(n)) throw ApiError.badRequest('sortOrder 必须是数字');
    sets.push('sort_order = ?');
    params.push(Math.trunc(n));
  }
  if (sets.length === 0) throw ApiError.badRequest('没有需要更新的字段');

  sets.push('updated_at = ?');
  params.push(nowIso(), id);
  run(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return toDocumentItem(requireDocument(id));
}

/* ------------------------------------------------------------------ 文件夹归属 */

/** 校验目标文件夹存在且是文库文件夹（作品集文件夹不能装文稿） */
function assertLibraryFolder(collectionId: string): void {
  const row = get<{ id: string; kind: string }>('SELECT id, kind FROM collections WHERE id = ?', collectionId);
  if (!row) throw ApiError.badRequest('指定的文件夹不存在');
  if (row.kind !== 'library') throw ApiError.badRequest('该文件夹属于作品集，不能放文稿');
}

/**
 * 批量重排 / 批量改归属（管理员拖拽后一次提交，事务内完成）
 * items 的顺序即最终展示顺序，sortOrder 按数组下标生成。
 */
export function reorderDocuments(items: { id: string; collectionId?: string | null }[]): number {
  if (!Array.isArray(items) || items.length === 0) throw ApiError.badRequest('items 不能为空');
  tx(() => {
    items.forEach((item, index) => {
      requireDocument(item.id);
      const sets = ['sort_order = ?', 'updated_at = ?'];
      const params: unknown[] = [index, nowIso()];
      if (item.collectionId !== undefined) {
        const cid = item.collectionId === null || item.collectionId === '' ? null : String(item.collectionId);
        if (cid) assertLibraryFolder(cid);
        sets.push('collection_id = ?');
        params.push(cid);
      }
      params.push(item.id);
      run(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, ...params);
    });
  });
  return items.length;
}

/* ------------------------------------------------------------------ 绑定文件 */

/** 某个文件当前被哪篇文稿绑定（null = 还没绑）—— 收录升格时用来避免重复建文稿 */
export function findDocumentIdByFile(fileId: string): string | null {
  return (
    get<{ document_id: string }>(
      'SELECT document_id FROM document_files WHERE file_id = ? LIMIT 1',
      fileId,
    )?.document_id ?? null
  );
}

export function listDocumentFiles(documentId: string): DocumentFileItem[] {
  const rows = all<{ id: string; file_id: string; sort_order: number; created_at: string }>(
    'SELECT * FROM document_files WHERE document_id = ? ORDER BY sort_order ASC, created_at ASC',
    documentId,
  );
  return rows.map((r) => {
    const file = findFileRow(r.file_id);
    return {
      id: r.id,
      fileId: r.file_id,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      file: file ? toFileItem(file) : null,
    };
  });
}

/**
 * 给文稿绑定一个文件。
 * 与「加入作品集」一致：绑定即把文件转为 public —— 否则访客点「下载所有文件」会拿到 403。
 */
export function bindDocumentFile(documentId: string, fileId: string): DocumentFileItem {
  requireDocument(documentId);
  const file = findFileRow(fileId);
  if (!file) throw ApiError.notFound('文件不存在');

  const exists = get<{ id: string }>(
    'SELECT id FROM document_files WHERE document_id = ? AND file_id = ?',
    documentId,
    fileId,
  );
  if (exists) throw ApiError.conflict('这个文件已经绑在这篇文稿上了');

  const next = get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM document_files WHERE document_id = ?',
    documentId,
  )?.c ?? 0;
  run(
    'INSERT INTO document_files (id, document_id, file_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
    newId('dfile'),
    documentId,
    fileId,
    next,
    nowIso(),
  );
  updateFile(fileId, { visibility: 'public' });

  const created = listDocumentFiles(documentId).find((f) => f.fileId === fileId);
  if (!created) throw ApiError.internal('绑定文件失败');
  return created;
}

export function unbindDocumentFile(documentId: string, fileId: string): void {
  const res = run('DELETE FROM document_files WHERE document_id = ? AND file_id = ?', documentId, fileId);
  if (res.changes === 0) throw ApiError.notFound('这篇文稿没有绑定该文件');
}

/** 打包下载用：只要还在磁盘上的绑定文件 */
export function downloadableDocumentFiles(documentId: string): DocumentFileItem[] {
  return listDocumentFiles(documentId).filter((f) => f.file !== null);
}

/** 删除：连同它绑定的 document_files 一起消失（外键 ON DELETE CASCADE） */
export function deleteDocument(id: string): void {
  requireDocument(id);
  run('DELETE FROM documents WHERE id = ?', id);
}
