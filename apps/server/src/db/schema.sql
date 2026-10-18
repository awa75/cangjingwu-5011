-- ==========================================================================
-- 《藏经坞》SQLite 表结构 —— 新站 v1（2026-10-17 重建）
--
-- 由来：由旧站 26.1.1 的 16 个增量迁移合并而成，逐表取舍后只保留本坞要用的。
--   删掉的：media_items（作品集展示项）、tasks（分析任务）、links（站外按钮）
--   去掉的列：documents.is_manual（说明页已废）
--   新增的：files.review_status 等四列 —— 支撑「先审后公开」
--
-- 约定：主键为 TEXT（形如 file_9f2c1a4b8e3d），时间统一 UTC ISO8601 字符串
--      布尔用 INTEGER 0/1，软删除用 deleted_at
-- ==========================================================================

-- ---------------------------------------------------------------- 用户与邀请
-- 坞主与会员同表。坞主身份由 .env 的 OWNER_USERNAME 决定，不用 role 列。
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | disabled
  nickname      TEXT NOT NULL DEFAULT '',
  invite_code   TEXT,                             -- 注册时用的码（可追溯）
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_level ON users(level);

-- 邀请码：18 位，三组「3 字母 + 3 数字」连写，例 KQZ111TRM802PLU913
-- （字母表去掉 I/O、数字去掉 0，避免口头或手抄看错；校验容错空格与大小写）
CREATE TABLE IF NOT EXISTS invite_codes (
  code       TEXT PRIMARY KEY,
  level      INTEGER NOT NULL DEFAULT 1,      -- 用此码注册后获得的等级
  max_uses   INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,                            -- NULL = 永不过期
  disabled   INTEGER NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_state ON invite_codes(disabled, expires_at);

-- 使用记录：谁在什么时候用哪个码注册的
CREATE TABLE IF NOT EXISTS invite_uses (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_uses_code ON invite_uses(code);

-- ---------------------------------------------------------------- 文件
-- 二进制在 storage/uploads 下。影像不作为独立栏目展示，只作文稿附件。
CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                 -- image | video | audio | doc | other
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,                 -- 磁盘上的文件名（含扩展名）
  ext           TEXT NOT NULL DEFAULT '',
  mime          TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  rel_path      TEXT NOT NULL,                 -- 相对 STORAGE_DIR，posix 分隔
  thumb_path    TEXT,                          -- 缩略图相对路径；图片无 ffmpeg 时回退为原图
  sha256        TEXT,
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,
  visibility    TEXT NOT NULL DEFAULT 'public',   -- public | private（坞主可单独隐藏已放行的文件）
  min_level     INTEGER NOT NULL DEFAULT 1,

  -- 审核（先审后公开）：新上传一律 pending，坞主放行后才对外可见
  review_status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  review_note   TEXT NOT NULL DEFAULT '',
  reviewed_at   TEXT,
  reviewed_by   TEXT,                             -- 放行者的 users.id

  -- 归属：任何登录用户都能投稿，所以要记谁传的（投稿人只看得到自己的）
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,

  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_kind_created  ON files(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_visibility    ON files(visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_deleted       ON files(deleted_at);
CREATE INDEX IF NOT EXISTS idx_files_review        ON files(review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_uploader      ON files(uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_level         ON files(min_level);

-- ---------------------------------------------------------------- 文库
-- 文件夹（分卷）。旧站用 kind 区分 portfolio|library；作品集已废，全部是文库，
-- 该列保留但只写 'library'，以免改动服务层与前端调用。
CREATE TABLE IF NOT EXISTS collections (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',   -- 列表页显示的一句话
  description_md TEXT NOT NULL DEFAULT '',   -- 卷首说明（Markdown）
  cover_file_id  TEXT,
  kind           TEXT NOT NULL DEFAULT 'library',
  min_level      INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  visible        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_sort ON collections(visible, sort_order ASC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_kind ON collections(kind, visible, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_collections_level ON collections(min_level);

-- Markdown 文稿
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  content_md    TEXT NOT NULL DEFAULT '',
  pinned        INTEGER NOT NULL DEFAULT 0,
  visible       INTEGER NOT NULL DEFAULT 1,
  min_level     INTEGER NOT NULL DEFAULT 1,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_order  ON documents(visible, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(collection_id, visible, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_documents_level  ON documents(min_level);

-- 文稿绑定的文件 —— 文库条目右侧「下载所有文件」的依据（影像即由此成为文稿附件）
CREATE TABLE IF NOT EXISTS document_files (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_files_unique ON document_files(document_id, file_id);
CREATE INDEX IF NOT EXISTS idx_document_files_doc ON document_files(document_id, sort_order ASC);

-- ---------------------------------------------------------------- 分享与设置
-- 分享令牌（可指向文件或文档）；对外分享一律以一次性契为凭
CREATE TABLE IF NOT EXISTS shares (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,                   -- file | document
  target_id   TEXT NOT NULL,
  expires_at  TEXT,                            -- NULL = 永不过期
  max_views   INTEGER,                         -- NULL = 不限次数
  views       INTEGER NOT NULL DEFAULT 0,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_target ON shares(target_type, target_id);

-- 站点文案/设置
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
