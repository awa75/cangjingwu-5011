/**
 * 配置加载与启动期强校验
 *
 * 加载顺序：真实环境变量 > ENV_FILE 指定文件 > 仓库根 .env > apps/server/.env > 默认值
 * 设计原则：密钥缺失/过弱时**直接拒绝启动**，不要带着不安全的默认值跑起来。
 *
 * 新站相对于旧站 26.1.1 砍掉的配置组：worker（分析机）、ai（问道台）、pet（宠物决策）、
 * dsh（内核 sidecar）。坞主身份由 .env 的 OWNER_USERNAME 决定，不在数据库里放角色列。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server */
export const SERVER_ROOT = path.resolve(here, '..');
/** 仓库根 */
export const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

/** 显式指定的 ENV_FILE 优先，其次是仓库根 .env，最后是 apps/server/.env */
function resolveEnvFile(): string | undefined {
  if (process.env.ENV_FILE) {
    const p = path.resolve(process.env.ENV_FILE);
    if (!fs.existsSync(p)) {
      console.error(`[config] ENV_FILE 指向的文件不存在：${p}`);
      process.exit(1);
    }
    return p;
  }
  return [path.join(REPO_ROOT, '.env'), path.join(SERVER_ROOT, '.env')].find((p) => fs.existsSync(p));
}

export const ENV_FILE = resolveEnvFile();
if (ENV_FILE) dotenv.config({ path: ENV_FILE });

// ---------------------------------------------------------------- 读取辅助

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) {
    console.error(`[config] ${name} 必须是整数，当前值：${v}`);
    process.exit(1);
  }
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function list(name: string, fallback: string[] = []): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 相对路径按仓库根解析；绝对路径原样使用 */
function dir(name: string, fallbackAbs: string): string {
  const v = process.env[name];
  if (!v) return fallbackAbs;
  return path.isAbsolute(v) ? v : path.resolve(REPO_ROOT, v);
}

// ---------------------------------------------------------------- 配置对象

const NODE_ENV = str('NODE_ENV', 'development');
const isProd = NODE_ENV === 'production';

const DATA_DIR = dir('DATA_DIR', path.join(SERVER_ROOT, 'data'));
const STORAGE_DIR = dir('STORAGE_DIR', path.join(SERVER_ROOT, 'storage'));
const WEB_DIST = dir('WEB_DIST', path.join(REPO_ROOT, 'apps/web/dist'));

export const config = {
  env: NODE_ENV,
  isProd,
  isDev: !isProd,
  envFile: ENV_FILE,

  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 8080),
  publicBaseUrl: str('PUBLIC_BASE_URL', `http://localhost:${int('PORT', 8080)}`).replace(/\/+$/, ''),
  siteName: str('SITE_NAME', '藏经坞'),

  paths: {
    serverRoot: SERVER_ROOT,
    repoRoot: REPO_ROOT,
    dataDir: DATA_DIR,
    storageDir: STORAGE_DIR,
    webDist: WEB_DIST,
  },

  /**
   * 坞主（唯一内容管理者）：建文稿、建文件夹、审上传。
   * 身份判定 = 登录用户名与 OWNER_USERNAME 相等，没有角色表可维护。
   */
  owner: {
    username: str('OWNER_USERNAME', 'keeper'),
    password: process.env.OWNER_PASSWORD ?? '',
    passwordHash: process.env.OWNER_PASSWORD_HASH ?? '',
  },

  jwt: {
    secret: str('JWT_SECRET', ''),
    expiresIn: str('JWT_EXPIRES_IN', '12h'),
  },

  upload: {
    maxBytes: int('UPLOAD_MAX_BYTES', 512 * 1024 * 1024),
    maxFiles: int('UPLOAD_MAX_FILES', 20),
  },

  /** 媒体探测：ffprobe 读时长/分辨率，ffmpeg 出缩略图。缺了也能跑，只是没有缩略图 */
  media: {
    enabled: bool('MEDIA_PROBE_ENABLED', true),
    ffmpegPath: str('FFMPEG_PATH', 'ffmpeg'),
    ffprobePath: str('FFPROBE_PATH', 'ffprobe'),
  },

  /** 收录开关：上传是否需要坞主放行。关掉即「先公开后看」 */
  review: {
    enabled: bool('REVIEW_REQUIRED', true),
  },

  corsOrigins: list('CORS_ORIGINS', []),

  rateLimit: {
    loginMax: int('LOGIN_RATE_MAX', 5),
    loginWindowSeconds: int('LOGIN_RATE_WINDOW_SECONDS', 60),
  },

  janitor: {
    intervalSeconds: int('JANITOR_INTERVAL_SECONDS', 30),
    tmpRetentionSeconds: int('TMP_RETENTION_SECONDS', 86400),
  },
} as const;

// ---------------------------------------------------------------- 启动校验

export interface ConfigProblem {
  key: string;
  message: string;
}

/**
 * `.env.example` 里的示例占位串。
 *
 * 为什么要单独认它们：这几个串**长度都够**（43 / 39 字符），
 * 现有那些"至少 32 字符"的校验统统放行 —— 于是照抄示例文件就能"正常启动"，
 * 却拿着一个人人皆知的密钥在跑。
 */
export const EXAMPLE_PLACEHOLDERS = new Set([
  'please-generate-a-random-secret-at-least-32-chars',
  'change-me-please-123',
]);

/** 判断一个密钥是不是"没配"或"照抄了示例文件" */
export function looksLikePlaceholderSecret(value: string | undefined | null): boolean {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return true;
  if (EXAMPLE_PLACEHOLDERS.has(s)) return true;
  return s.startsWith('please-') || s.startsWith('change-me') || s === 'changeme';
}

/** 返回问题清单（空数组表示配置合格），便于测试与 CLI 复用 */
export function checkConfig(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  if (!config.jwt.secret || config.jwt.secret.length < 32) {
    problems.push({
      key: 'JWT_SECRET',
      message: 'JWT_SECRET 缺失或过短（至少 32 字符）。生成：openssl rand -base64 48',
    });
  } else if (isProd && looksLikePlaceholderSecret(config.jwt.secret)) {
    // 生产环境用示例串 = 任何人都能自己签一个坞主令牌。
    problems.push({
      key: 'JWT_SECRET',
      message: 'JWT_SECRET 还是 .env.example 里的示例串 —— 任何人都能伪造登录令牌。生成：openssl rand -base64 48',
    });
  }

  if (!config.owner.passwordHash && config.owner.password.length < 8) {
    problems.push({
      key: 'OWNER_PASSWORD',
      message: 'OWNER_PASSWORD 缺失或过短（至少 8 字符）；或改用 OWNER_PASSWORD_HASH',
    });
  }

  if (!config.owner.username.trim()) {
    problems.push({ key: 'OWNER_USERNAME', message: 'OWNER_USERNAME 不能为空 —— 它是坞主身份的唯一依据' });
  }

  if (config.upload.maxBytes < 1024 * 1024) {
    problems.push({ key: 'UPLOAD_MAX_BYTES', message: '上传上限过小（至少 1MB）' });
  }

  return problems;
}

/** 启动期调用：有问题就打印并退出，绝不用不安全默认值继续跑 */
export function assertConfig(): void {
  const problems = checkConfig();
  if (problems.length === 0) return;
  console.error('\n[config] 配置校验未通过，服务拒绝启动：\n');
  for (const p of problems) console.error(`  ✗ ${p.key}: ${p.message}`);
  console.error(
    `\n请编辑 ${ENV_FILE ?? path.join(REPO_ROOT, '.env')}（可从 .env.example 复制），然后重试。\n`,
  );
  process.exit(1);
}

/** 打印启动信息（隐藏密钥） */
export function describeConfig(): string[] {
  return [
    `NODE_ENV=${config.env}`,
    `监听=${config.host}:${config.port}`,
    `对外地址=${config.publicBaseUrl}`,
    `坞主=${config.owner.username}`,
    `数据目录=${config.paths.dataDir}`,
    `存储目录=${config.paths.storageDir}`,
    `前端产物=${config.paths.webDist}${fs.existsSync(config.paths.webDist) ? '' : '（不存在，仅提供 API）'}`,
    `配置文件=${config.envFile ?? '(未找到，全部使用环境变量/默认值)'}`,
    `上传上限=${(config.upload.maxBytes / 1024 / 1024).toFixed(0)}MB × ${config.upload.maxFiles}`,
    `收录审核=${config.review.enabled ? '开启（上传进待审区）' : '关闭（上传即公开）'}`,
    `媒体探测=${config.media.enabled ? `启用 (${config.media.ffprobePath})` : '禁用'}`,
  ];
}
