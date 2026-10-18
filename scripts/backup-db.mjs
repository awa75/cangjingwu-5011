/**
 * SQLite 一致性热备份：VACUUM INTO
 *
 * 用法：
 *   node scripts/backup-db.mjs /var/backups/cangjingwu/app-20260214-030000.db
 *
 * 为什么不用 cp：WAL 模式下直接复制 app.db 可能拿到不一致的快照。
 * VACUUM INTO 会生成一个完整、已整理、可直接打开的单文件副本，且不需要停服务。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 与 config.ts 同源的 .env 查找顺序 */
function loadEnvFile() {
  const candidates = [
    process.env.ENV_FILE,
    // ★ 生产的配置在这儿（deploy.sh 也是用 ENV_FILE 指它的）。
    //   少这一条会静默回退到"仓库内的 data/"，于是备份在生产上直接找不到库
    //   （2026-09-23 真踩过：backup.sh 因此失败，好在 && 链把发布也一起拦住了）。
    '/etc/cangjingwu/cangjingwu.env',
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'apps', 'server', '.env'),
  ].filter(Boolean);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const map = {};
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) map[m[1]] = m[2];
    }
    return map;
  }
  return {};
}

const env = loadEnvFile();

/**
 * 找数据库文件：**按候选逐个试，谁在就用谁**，而不是"猜一个"。
 * 生产是 /var/lib/cangjingwu/data/app.db（DATA_DIR 指到 data 那层），
 * 开发是 <repo>/apps/server/data/app.db —— 两种都能命中。
 */
const candidateDirs = [
  env.DATA_DIR && path.resolve(env.DATA_DIR),
  '/var/lib/cangjingwu/data',
  '/var/lib/cangjingwu',
  path.join(repoRoot, 'apps', 'server', 'data'),
].filter(Boolean);

const source = candidateDirs.map((d) => path.join(d, 'app.db')).find((p) => fs.existsSync(p));

const target = process.argv[2];
if (!target) {
  console.error('用法：node scripts/backup-db.mjs <目标文件路径>');
  process.exit(1);
}
if (!source) {
  console.error('找不到数据库文件。找过这些位置：');
  for (const d of candidateDirs) console.error(`  ${path.join(d, 'app.db')}`);
  console.error(
    '修法：设 ENV_FILE 指向配置文件（生产是 /etc/cangjingwu/cangjingwu.env），或直接设 DATA_DIR。',
  );
  process.exit(1);
}

const targetAbs = path.resolve(target);
fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
if (fs.existsSync(targetAbs)) {
  console.error(`目标文件已存在，请换一个名字：${targetAbs}`);
  process.exit(1);
}

// VACUUM INTO 的路径写在 SQL 里，需转义单引号
const escaped = targetAbs.split(path.sep).join('/').replace(/'/g, "''");

const db = new DatabaseSync(source);
try {
  db.exec(`VACUUM INTO '${escaped}'`);
} finally {
  db.close();
}

const size = fs.statSync(targetAbs).size;
// 把**源路径**也打出来：备份错文件是那种"看起来成功"的事故，必须留证据
console.log(`数据库已备份：${targetAbs}（${(size / 1024).toFixed(1)} KB）`);
console.log(`  源：${source}`);
