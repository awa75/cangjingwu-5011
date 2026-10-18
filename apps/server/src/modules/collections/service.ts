/**
 * 文库文件夹（collections）
 *
 * 一个文件夹 = 标题 + 一句话摘要 + 卷首说明 Markdown。
 * 文稿通过 documents.collection_id 归属；为空即「未归档」。
 *
 * 旧站这套服务同时服务两个域（kind='portfolio' 装 media_items、kind='library' 装 documents）。
 * 作品集已废：kind 恒为 'library'，字段保留以免改动表结构与调用签名。
 */
import type { Collection, CollectionKind } from '@cangjingwu/shared';
import { all, get, run, tx } from '../../db/index.js';
import { ApiError } from '../../utils/response.js';
import { newId, nowIso, slugify } from '../../utils/ids.js';
import { findFileRow, toFileItem } from '../files/service.js';

import { clampMinLevel } from '../../utils/levels.js';

export interface CollectionRow {
  id: string;
  slug: string;
  title: string;
  kind: CollectionKind;
  summary: string;
  description_md: string;
  cover_file_id: string | null;
  sort_order: number;
  visible: number;
  /** 最低等级（1..9）：夹内内容也受它约束 */
  min_level: number;
  created_at: string;
  updated_at: string;
}

/** 文件夹里有几篇文稿（可见口径与前台一致） */
function countLibraryDocs(collectionId: string, visibleOnly = true): number {
  return (
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM documents WHERE collection_id = ?${visibleOnly ? ' AND visible = 1' : ''}`,
      collectionId,
    )?.c ?? 0
  );
}

/** 一次性把全部文件夹的文稿数查出来，避免列表页 N+1 */
function libraryDocCounts(visibleOnly: boolean): Map<string, number> {
  const rows = all<{ collection_id: string; c: number }>(
    `SELECT collection_id, COUNT(*) AS c FROM documents
     WHERE collection_id IS NOT NULL${visibleOnly ? ' AND visible = 1' : ''}
     GROUP BY collection_id`,
  );
  return new Map(rows.map((r) => [r.collection_id, r.c]));
}

/** 封面：只认显式指定的文件；没指定就留空（前端退回用第一篇文稿） */
function resolveCover(row: CollectionRow) {
  if (!row.cover_file_id) return null;
  const file = findFileRow(row.cover_file_id);
  return file ? toFileItem(file) : null;
}

function buildItem(row: CollectionRow, withDescription = true, docCount?: number): Collection {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind: row.kind,
    summary: row.summary,
    descriptionMd: withDescription ? row.description_md : '',
    coverFileId: row.cover_file_id,
    coverFile: resolveCover(row),
    sortOrder: row.sort_order,
    visible: row.visible === 1,
    minLevel: row.min_level,
    itemCount: docCount ?? countLibraryDocs(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCollectionItem(row: CollectionRow, withDescription = true): Collection {
  return buildItem(row, withDescription);
}

export function listCollections(
  opts: { visibleOnly?: boolean; kind?: CollectionKind; withDescription?: boolean } = {},
): Collection[] {
  const where: string[] = [];
  if (opts.visibleOnly) where.push('visible = 1');
  if (opts.kind) where.push('kind = ?');
  const rows = all<CollectionRow>(
    `SELECT * FROM collections ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY sort_order ASC, created_at ASC`,
    ...(opts.kind ? [opts.kind] : []),
  );
  // 文稿数一次查完，避免每个文件夹都全表扫一遍
  const docCounts = libraryDocCounts(true);
  return rows.map((row) =>
    buildItem(row, opts.withDescription ?? false, docCounts.get(row.id) ?? 0),
  );
}

/** 批量重排文件夹（坞主拖拽后一次提交） */
export function reorderCollections(items: { id: string; sortOrder?: number }[]): number {
  if (!Array.isArray(items) || items.length === 0) throw ApiError.badRequest('items 不能为空');
  tx(() => {
    items.forEach((item, index) => {
      requireCollectionRow(item.id);
      const n = Number.isFinite(Number(item.sortOrder)) ? Math.trunc(Number(item.sortOrder)) : index;
      run('UPDATE collections SET sort_order = ?, updated_at = ? WHERE id = ?', n, nowIso(), item.id);
    });
  });
  return items.length;
}

export function requireCollectionRow(id: string): CollectionRow {
  const row = get<CollectionRow>('SELECT * FROM collections WHERE id = ?', id);
  if (!row) throw ApiError.notFound('文件夹不存在');
  return row;
}

export function findCollectionBySlug(slug: string, visibleOnly = false): CollectionRow | undefined {
  return get<CollectionRow>(
    `SELECT * FROM collections WHERE slug = ?${visibleOnly ? ' AND visible = 1' : ''}`,
    slug,
  );
}

/** slug 唯一化：撞了就加 -2、-3…（自己更新自己时排除自身） */
function uniqueSlug(base: string, exceptId?: string): string {
  const seed = slugify(base);
  let candidate = seed;
  for (let i = 2; i < 200; i += 1) {
    const row = get<{ id: string }>('SELECT id FROM collections WHERE slug = ?', candidate);
    if (!row || row.id === exceptId) return candidate;
    candidate = `${seed}-${i}`;
  }
  return `${seed}-${newId('x').slice(2, 8)}`;
}

export function createCollection(body: Record<string, unknown>): Collection {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw ApiError.badRequest('缺少 title');

  const now = nowIso();
  const id = newId('col');
  const sortOrder = Number.isFinite(Number(body.sortOrder))
    ? Math.trunc(Number(body.sortOrder))
    : (get<{ c: number }>("SELECT COUNT(*) AS c FROM collections WHERE kind = 'library'")?.c ?? 0);

  const coverFileId =
    typeof body.coverFileId === 'string' && body.coverFileId ? body.coverFileId : null;
  if (coverFileId && !findFileRow(coverFileId)) throw ApiError.badRequest('封面文件不存在');

  run(
    `INSERT INTO collections (id, slug, title, kind, summary, description_md, cover_file_id, sort_order, visible, min_level, created_at, updated_at)
     VALUES (?, ?, ?, 'library', ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    uniqueSlug(typeof body.slug === 'string' && body.slug ? body.slug : title),
    title,
    typeof body.summary === 'string' ? body.summary : '',
    typeof body.descriptionMd === 'string' ? body.descriptionMd : '',
    coverFileId,
    sortOrder,
    body.visible === false ? 0 : 1,
    clampMinLevel(body.minLevel ?? 1),
    now,
    now,
  );
  return toCollectionItem(requireCollectionRow(id));
}

export function updateCollection(id: string, body: Record<string, unknown>): Collection {
  const row = requireCollectionRow(id);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (typeof body.title === 'string' && body.title.trim()) {
    sets.push('title = ?');
    params.push(body.title.trim());
  }
  if (typeof body.slug === 'string' && body.slug.trim()) {
    sets.push('slug = ?');
    params.push(uniqueSlug(body.slug, row.id));
  }
  if (typeof body.summary === 'string') {
    sets.push('summary = ?');
    params.push(body.summary);
  }
  if (typeof body.descriptionMd === 'string') {
    sets.push('description_md = ?');
    params.push(body.descriptionMd);
  }
  if (body.coverFileId !== undefined) {
    const cover = body.coverFileId === null || body.coverFileId === '' ? null : String(body.coverFileId);
    if (cover && !findFileRow(cover)) throw ApiError.badRequest('封面文件不存在');
    sets.push('cover_file_id = ?');
    params.push(cover);
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) throw ApiError.badRequest('sortOrder 必须是数字');
    sets.push('sort_order = ?');
    params.push(Math.trunc(n));
  }
  if (body.visible !== undefined) {
    sets.push('visible = ?');
    params.push(body.visible ? 1 : 0);
  }
  if (body.minLevel !== undefined) {
    sets.push('min_level = ?');
    params.push(clampMinLevel(body.minLevel));
  }
  if (sets.length === 0) throw ApiError.badRequest('没有需要更新的字段');

  sets.push('updated_at = ?');
  params.push(nowIso(), row.id);
  run(`UPDATE collections SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return toCollectionItem(requireCollectionRow(row.id));
}

/** 删除文件夹：夹内文稿自动回到「未归档」（外键 ON DELETE SET NULL），文稿本身不动 */
export function deleteCollection(id: string): { removed: string; orphaned: number } {
  requireCollectionRow(id);
  const orphaned =
    get<{ c: number }>('SELECT COUNT(*) AS c FROM documents WHERE collection_id = ?', id)?.c ?? 0;
  run('DELETE FROM collections WHERE id = ?', id);
  return { removed: id, orphaned };
}
