-- ==========================================================================
-- 迁移 v3：文库文件夹 + 文稿绑定文件
--
-- 背景：
--   1) 作品集的文件夹（v2 的 collections）只服务作品集；文库也要文件夹，
--      所以给 collections 加 kind 区分归属：portfolio（作品集）| library（文库）。
--   2) 文稿要能排进文件夹、要能手动排序（管理员拖拽），所以 documents 加
--      collection_id 与 sort_order。
--   3) 文库条目的「下载所有文件」需要一个显式的绑定关系（不是从正文里猜），
--      所以新增 document_files 关联表：一篇文稿 ↔ 若干已上传文件。
--
-- 注意：本文件只用于 v2 → v3 的增量升级，**不要**回填进 schema.sql。
-- ==========================================================================

-- 文件夹分域：已有文件夹全部归作品集（DEFAULT 保证历史数据不受影响）
ALTER TABLE collections ADD COLUMN kind TEXT NOT NULL DEFAULT 'portfolio';
CREATE INDEX IF NOT EXISTS idx_collections_kind ON collections(kind, visible, sort_order ASC);

-- 文稿归属文件夹 + 排序（为空即"未归档"）
ALTER TABLE documents ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(collection_id, visible, sort_order ASC);

-- 文稿绑定的文件（文库「下载所有文件」用）
CREATE TABLE IF NOT EXISTS document_files (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_files_unique ON document_files(document_id, file_id);
CREATE INDEX IF NOT EXISTS idx_document_files_doc ON document_files(document_id, sort_order ASC);
