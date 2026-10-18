-- ==========================================================================
-- 迁移 v2：作品集「文件夹（分卷）」
--
-- 背景：v1 的 media_items 是一个平铺列表，作品多了就没法整理。
--       v2 引入 collections（文件夹），每个文件夹有自己的标题、摘要与卷首说明（Markdown）。
--       media_items.collection_id 为空表示「未归档」，仍然会出现在作品集页的未归档区。
--
-- 注意：本文件只用于 v1 → v2 的增量升级，**不要**把这里的语句回填进 schema.sql，
--       否则全新库先跑 schema.sql 再跑本迁移会重复建列而失败。
-- ==========================================================================

CREATE TABLE IF NOT EXISTS collections (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',   -- 列表页显示的一句话
  description_md TEXT NOT NULL DEFAULT '',   -- 文件夹详情页顶部的说明（Markdown）
  cover_file_id  TEXT,                       -- 封面文件；为空则取文件夹内第一件作品
  sort_order     INTEGER NOT NULL DEFAULT 0,
  visible        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_sort ON collections(visible, sort_order ASC, created_at DESC);

-- 归属文件夹；删除文件夹时自动把成员放回「未归档」（依赖 PRAGMA foreign_keys=ON）
ALTER TABLE media_items ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_media_collection ON media_items(collection_id, visible, sort_order ASC);
