-- ==========================================================================
-- v6：会员体系（角色 / 等级 / 邀请码 / 站外按钮）
--
-- 设计要点：
--   * 管理员也是 users 里的一行（role='admin'），登录流程只有一套；
--   * 等级 level 1..9：既作身份标牌，也用于「站外按钮门槛」与「内容最低等级」（内容分级在 v7）；
--   * 邀请码 18 位，三组「3 字母 + 3 数字」连写，例：KQZ111TRM802PLU913
--     （生成时字母表去掉 I/O、数字去掉 0，避免口头或手抄看错；校验时容错空格/连字符/大小写）
--   * 站外按钮由管理员维护，登录后按等级显示。
-- ==========================================================================

-- 既有行（原本只有管理员）默认就是 admin
ALTER TABLE users ADD COLUMN role        TEXT    NOT NULL DEFAULT 'admin';
ALTER TABLE users ADD COLUMN level       INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN status      TEXT    NOT NULL DEFAULT 'active'; -- active | disabled
ALTER TABLE users ADD COLUMN nickname    TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN invite_code TEXT;                              -- 注册时用的码（可追溯）
ALTER TABLE users ADD COLUMN note        TEXT    NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_users_role_level ON users(role, level);

-- 邀请码
CREATE TABLE IF NOT EXISTS invite_codes (
  code       TEXT PRIMARY KEY,
  level      INTEGER NOT NULL DEFAULT 1,      -- 用此码注册后获得的等级
  max_uses   INTEGER NOT NULL DEFAULT 1,      -- 可注册的次数
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

-- 登录后显示的站外按钮
CREATE TABLE IF NOT EXISTS links (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  min_level  INTEGER NOT NULL DEFAULT 1,      -- 达到该等级才显示（1 = 所有会员）
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible    INTEGER NOT NULL DEFAULT 1,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_order ON links(visible, sort_order ASC);
