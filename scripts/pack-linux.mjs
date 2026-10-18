/**
 * 打 Linux 部署包
 *
 *   node scripts/pack-linux.mjs
 *   → dist-linux/cangjingwu-v0.5.0-linux.tar.gz   （顶层目录 cangjingwu/）
 *
 * 设计要点：
 *  1. **不打包 node_modules**：esbuild 等依赖含平台二进制，在 Windows 打包会带上 win32 版本，
 *     到 Linux 必然报错。目标机执行一次 `pnpm install` 即可（install.sh 已含）。
 *  2. 排除 .env / data / storage，避免把本机密钥与测试数据带到服务器。
 *  3. 打包前把文本文件统一成 LF、给 .sh 加可执行位 —— Windows 上写的 CRLF 会让 bash 报
 *     `bad interpreter: /usr/bin/env bash^M`，这一步专门解决它。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeZip } from './lib/zip.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const VERSION = pkg.version ?? '0.0.0';

const OUT_DIR = path.join(repoRoot, 'dist-linux');
const STAGE_ROOT = path.join(OUT_DIR, 'stage');
const STAGE = path.join(STAGE_ROOT, 'cangjingwu');
const ARCHIVE = path.join(OUT_DIR, `cangjingwu-v${VERSION}-linux.tar.gz`);

/** 顶层需要包含的文件 */
const INCLUDE_FILES = [
  'START-HERE.txt',
  'setup.sh',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'tsconfig.base.json',
  '.env.example',
  '.gitignore',
  'README.md',
];

/** 顶层需要包含的目录 */
const INCLUDE_DIRS = ['apps', 'packages', 'scripts', 'deploy', 'docs', 'worker', 'integrations', 'coordination'];

/** 任何层级都要排除的目录名 */
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.vite',
  'dist',
  'data',
  'storage',
  'dist-linux',
  '__pycache__',
  '.venv',
  '.idea',
  '.vscode',
  // 多会话协同的本地状态与**凭据**：绝不能进包
  '.state',
]);

/**
 * Gradle 的输出/缓存目录名 —— **只在 Gradle 工程根下**才排除，判据见 isGradleOutput。
 *
 * ★ 这几个名字曾经是无条件按名排除的，于是出过一次静默事故：
 *   MC 的 F5b 生成器包就叫 `.../cangjingwu/build/`（与 harness 同理），
 *   整包 .java 被悄悄从发布包里丢掉 —— 不报错、不提示，
 *   只有在目标机上发现源码少一块时才会知道。
 */
const GRADLE_OUTPUT_DIRS = new Set(['build', 'run', '.gradle']);
const GRADLE_MARKERS = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];

/** 任何层级都要排除的文件名/后缀 */
const EXCLUDE_FILES = new Set([
  '.env',
  '.env.local',
  'pnpm-debug.log',
  'worker.log',
  // ★ 协同密钥：coordination/ 会随包发到另一台机器（那边需要规则与工具），
  //   但这把密钥绝不能跟着走 —— 每台机器各自填自己的
  '.coord-key',
]);
const EXCLUDE_EXT = new Set(['.log', '.db', '.db-wal', '.db-shm', '.tsbuildinfo']);

/** 已知二进制后缀：不做换行归一化 */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.mp4', '.mov', '.webm', '.zip', '.gz', '.tar',
  // ★ .jar 必须在这里：Gradle wrapper 的 gradle-wrapper.jar 是二进制，
  //   当成文本做 CRLF 归一化会把它弄坏 —— 到目标机上 `gradlew` 直接跑不起来。
  '.jar', '.class',
]);

/**
 * 只在"Gradle 工程根"下排除 build / run / .gradle。
 * Gradle 的输出目录一定紧挨着 build.gradle / settings.gradle；
 * 源码里那个恰好叫 build 的包旁边没有这些标记，所以不该被排除。
 */
function isGradleOutput(srcDir) {
  const parent = path.dirname(srcDir);
  return GRADLE_MARKERS.some((m) => fs.existsSync(path.join(parent, m)));
}

function shouldSkipDir(name, srcDir) {
  if (!EXCLUDE_DIRS.has(name) && !GRADLE_OUTPUT_DIRS.has(name)) return false;
  if (GRADLE_OUTPUT_DIRS.has(name)) return isGradleOutput(srcDir);
  return true;
}

function shouldSkipFile(name) {
  if (EXCLUDE_FILES.has(name)) return true;
  const ext = path.extname(name).toLowerCase();
  return EXCLUDE_EXT.has(ext);
}

const copied = [];
const skipped = [];
const suspicious = [];

/** 被排除的目录里若还留着源码，多半是"按名字误伤"（见 GRADLE_OUTPUT_DIRS 的注释）—— 吵一声 */
const TRIPWIRE_IGNORE = new Set(['node_modules', '.git', '.vite', '__pycache__', '.venv', '.idea', '.vscode']);
const SOURCE_EXT = new Set(['.java', '.kt', '.py', '.rb', '.go', '.rs', '.sql', '.ts', '.tsx', '.vue']);

function noteSuspiciousSkip(absDir, rel) {
  if (TRIPWIRE_IGNORE.has(path.basename(absDir))) return;
  let hits = 0;
  const probe = (dir, depth) => {
    if (depth > 3 || hits > 0) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits > 0) return;
      if (e.isDirectory()) {
        if (!shouldSkipDir(e.name, path.join(dir, e.name))) probe(path.join(dir, e.name), depth + 1);
      } else if (SOURCE_EXT.has(path.extname(e.name).toLowerCase())) {
        hits += 1;
      }
    }
  };
  probe(absDir, 0);
  if (hits > 0) suspicious.push(rel.split(path.sep).join('/'));
}

function copyTree(srcDir, destDir, base) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const rel = path.join(base, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name, src)) {
        skipped.push(`${rel}/`);
        noteSuspiciousSkip(src, rel);
        continue;
      }
      copyTree(src, path.join(destDir, entry.name), rel);
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipFile(entry.name)) {
      skipped.push(rel);
      continue;
    }
    fs.copyFileSync(src, path.join(destDir, entry.name));
    copied.push(rel.split(path.sep).join('/'));
  }
}

/** 换行归一化 + .sh 可执行位 */
function normalizeFile(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (BINARY_EXT.has(ext)) return;

  const buf = fs.readFileSync(absPath);
  if (buf.includes(0)) return; // 含 NUL，视为二进制

  const text = buf.toString('utf8');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized !== text) fs.writeFileSync(absPath, normalized, 'utf8');

  if (ext === '.sh') fs.chmodSync(absPath, 0o755);
}

function walk(absDir, fn) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) walk(abs, fn);
    else if (entry.isFile()) fn(abs);
  }
}

// ---------------------------------------------------------------- 打包
console.log(`\x1b[36m打包《藏经坞》Linux 部署包 v${VERSION}\x1b[0m`);

fs.rmSync(STAGE_ROOT, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

for (const file of INCLUDE_FILES) {
  const src = path.join(repoRoot, file);
  if (!fs.existsSync(src)) {
    console.warn(`  ! 缺少 ${file}（跳过）`);
    continue;
  }
  fs.copyFileSync(src, path.join(STAGE, file));
  copied.push(file);
}

for (const dir of INCLUDE_DIRS) {
  const src = path.join(repoRoot, dir);
  if (!fs.existsSync(src)) {
    console.warn(`  ! 缺少目录 ${dir}/（跳过）`);
    continue;
  }
  copyTree(src, path.join(STAGE, dir), dir);
}

walk(STAGE, normalizeFile);

if (suspicious.length) {
  console.warn('\n\x1b[33m⚠ 以下目录被排除，但里面还有源码文件 —— 请确认不是"按名字误伤"：\x1b[0m');
  for (const p of suspicious) console.warn(`  ! ${p}`);
  console.warn('\x1b[33m  （确实是构建产物就忽略；否则该改 EXCLUDE_DIRS / GRADLE_OUTPUT_DIRS）\x1b[0m');
}

// 包里带 shell 脚本，所以打包前先做语法体检 —— 免得拿到服务器上才发现少个 fi
function findBash() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
          path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
        ]
      : ['/bin/bash', '/usr/bin/bash'];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

const bashBin = findBash();
if (bashBin) {
  const shellScripts = [];
  walk(STAGE, (abs) => {
    if (abs.endsWith('.sh')) shellScripts.push(abs);
  });
  let broken = 0;
  for (const script of shellScripts.sort()) {
    const r = spawnSync(bashBin, ['-n', script], { encoding: 'utf8' });
    const rel = path.relative(STAGE, script).split(path.sep).join('/');
    if (r.status === 0) {
      console.log(`  ✓ bash 语法检查通过：${rel}`);
    } else {
      broken += 1;
      console.error(`  ✗ bash 语法错误：${rel}\n${r.stderr ?? ''}`);
    }
  }
  if (broken > 0) {
    console.error('\n\x1b[31mshell 脚本存在语法错误，已中止打包。\x1b[0m');
    process.exit(1);
  }
} else {
  console.warn('  ! 未找到 bash，跳过 shell 语法检查');
}

console.log(`  已收集 ${copied.length} 个文件，排除 ${skipped.length} 项（node_modules/.env/data/storage 等）`);

// 打包清单，便于事后核对
const manifest = copied.sort().map((rel) => {
  const abs = path.join(STAGE, rel);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16);
  return `${hash}  ${rel}`;
});
fs.writeFileSync(path.join(STAGE, 'MANIFEST.txt'), `# cangjingwu v${VERSION} 打包清单\n${manifest.join('\n')}\n`, 'utf8');

fs.rmSync(ARCHIVE, { force: true });
const tar = spawnSync('tar', ['-czf', ARCHIVE, '-C', STAGE_ROOT, 'cangjingwu'], {
  stdio: 'inherit',
});
if (tar.status !== 0) {
  console.error('\n\x1b[31mtar 打包失败。\x1b[0m Linux/macOS 自带 tar；Windows 10+ 也自带。');
  process.exit(1);
}

const size = fs.statSync(ARCHIVE).size;
const archiveHash = crypto.createHash('sha256').update(fs.readFileSync(ARCHIVE)).digest('hex');

// ---------------------------------------------------------------- 顺便出一个 .zip
// tar.gz 是 Linux 上的标准格式；zip 是为了方便在 Windows 上双击查看/用面板上传。
// 用自带 writer 而不是系统压缩命令：Windows 的 Compress-Archive 会把中文文件名写成乱码。
const ZIP = path.join(OUT_DIR, `cangjingwu-v${VERSION}-linux.zip`);
fs.rmSync(ZIP, { force: true });
let zipSize = 0;
let zipEntries = 0;

try {
  // 传 STAGE_ROOT 而不是 STAGE：这样包内会保留 cangjingwu/ 顶层目录，与 tar.gz 结构一致
  const info = writeZip(ZIP, STAGE_ROOT);
  zipSize = info.bytes;
  zipEntries = info.entries;
} catch (err) {
  console.warn(`  ! 生成 .zip 失败（不影响 tar.gz 使用）：${err.message}`);
}

// 清理暂存目录，只留最终产物
fs.rmSync(STAGE_ROOT, { recursive: true, force: true });

const relArchive = path.relative(repoRoot, ARCHIVE);

console.log(`\n\x1b[32m✔ 打包完成\x1b[0m`);
console.log(`  ${relArchive}`);
console.log(`    ${(size / 1024).toFixed(1)} KB   SHA256 ${archiveHash}`);
if (zipEntries > 0) {
  console.log(`  ${path.relative(repoRoot, ZIP)}`);
  console.log(
    `    ${(zipSize / 1024).toFixed(1)} KB   ${zipEntries} 个条目（Windows 上双击更方便；Linux 端用 unzip 解）`,
  );
}

console.log(`\n──── 接下来怎么做 ────`);
console.log(`1) 上传（任选一种，二选一都行）`);
console.log(`   scp ${relArchive} root@你的服务器IP:/tmp/`);
console.log(`   （或用 WinSCP / 宝塔面板上传）`);
console.log(`2) 服务器上解包并安装 —— 只需要运行 setup.sh 这一个文件`);
console.log(`   cd /tmp && tar -xzf ${path.basename(ARCHIVE)} && cd cangjingwu`);
console.log(`   sudo bash setup.sh                          # 装后端 + 构建前端`);
console.log(`   sudo bash setup.sh --with-nginx --domain 你的域名   # 连 Nginx 一起配`);
console.log(`3) 验证`);
console.log(`   curl http://127.0.0.1:8080/api/health`);
