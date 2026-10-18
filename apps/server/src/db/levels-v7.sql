-- ==========================================================================
-- v7：内容分级（最低等级 min_level）
--
-- 规则：每一类内容都能设「最低等级」（1..9，默认 1 = 所有人可见）。
--   * 匿名访客按 0 级看待 → 只能看到 min_level = 1 的内容；
--   * 会员按自己的等级看；
--   * 坞主（admin）全看。
-- 继承：文件夹的最低等级同样约束夹内内容（文稿在文库文件夹里、作品在作品集文件夹里）。
-- 不够等级的内容**整条不出现**（列表里过滤掉，单篇直接 404，媒体文件 403），不显示"上锁"。
-- ==========================================================================

ALTER TABLE files       ADD COLUMN min_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents   ADD COLUMN min_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE collections ADD COLUMN min_level INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_files_level       ON files(min_level);
CREATE INDEX IF NOT EXISTS idx_documents_level   ON documents(min_level);
CREATE INDEX IF NOT EXISTS idx_collections_level ON collections(min_level);
