-- ==========================================================================
-- 问卷系统（迁移 v2）
--
-- 定位：坞主自己用的调查表。**不进文库、不在任何导航里**，只有坞主在编辑台
-- 看得到；作答者必须拿到坞主发出去的 /q/<token> 链接才能打开，无链接即无入口。
--
-- 四张表：
--   surveys            一份问卷（令牌、开关、期限、名额、是否限同一设备一次）
--   survey_questions   题目（单选/多选/填空/长文本/评分）
--   survey_responses   一次提交（按问卷聚合，不记账号 —— 作答者不需要登录）
--   survey_answers     逐题答案（value_json 存 string | string[] | number | null）
--
-- 与 shares 表的区别：shares 是「把已有内容按令牌放出去」，surveys 是「收内容」。
-- 令牌形状相同（32 字节 base64url，不可枚举），互不复用。
-- ==========================================================================

CREATE TABLE IF NOT EXISTS surveys (
  id              TEXT PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description_md  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'open',  -- open | closed
  expires_at      TEXT,                          -- NULL = 不限期
  max_responses   INTEGER,                       -- NULL = 不限份数
  one_per_visitor INTEGER NOT NULL DEFAULT 1,    -- 1 = 同一浏览器只收一份
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_surveys_status ON surveys(status, created_at DESC);

CREATE TABLE IF NOT EXISTS survey_questions (
  id           TEXT PRIMARY KEY,
  survey_id    TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL,                    -- single | multiple | text | paragraph | rating
  title        TEXT NOT NULL,
  hint         TEXT NOT NULL DEFAULT '',
  required     INTEGER NOT NULL DEFAULT 0,
  options_json TEXT NOT NULL DEFAULT '[]',       -- single/multiple 的选项
  max_rating   INTEGER NOT NULL DEFAULT 5,       -- rating 的满分（2..10）
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions(survey_id, sort_order ASC);

CREATE TABLE IF NOT EXISTS survey_responses (
  id           TEXT PRIMARY KEY,
  survey_id    TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  submitted_at TEXT NOT NULL,
  -- 只存哈希：用来实现「同一浏览器一份」，不落明文 IP / 指纹
  visitor_hash TEXT NOT NULL DEFAULT '',
  ua           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_survey_responses_visitor ON survey_responses(survey_id, visitor_hash);

CREATE TABLE IF NOT EXISTS survey_answers (
  id          TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  value_json  TEXT NOT NULL DEFAULT 'null'
);
CREATE INDEX IF NOT EXISTS idx_survey_answers_response ON survey_answers(response_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_question ON survey_answers(question_id);
