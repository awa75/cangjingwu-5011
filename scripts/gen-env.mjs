/**
 * 生成 .env：以 .env.example 为模板，为密钥类字段填入随机值。
 * 用法（仓库根）：node scripts/gen-env.mjs [--force]
 *
 * 已存在 .env 时默认不覆盖，除非显式传 --force。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(repoRoot, '.env.example');
const targetPath = path.join(repoRoot, '.env');
const force = process.argv.includes('--force');

if (!fs.existsSync(templatePath)) {
  console.error(`找不到模板：${templatePath}`);
  process.exit(1);
}

if (fs.existsSync(targetPath) && !force) {
  console.log('.env 已存在，未覆盖。需要重新生成请加 --force');
  process.exit(0);
}

const secret = (bytes) => crypto.randomBytes(bytes).toString('base64url').slice(0, 48);
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

const replacements = {
  JWT_SECRET: secret(36),
  WORKER_API_KEY: hex(32),
  ADMIN_PASSWORD: `cjw-${hex(4)}-dev`,
};

const lines = fs.readFileSync(templatePath, 'utf8').split(/\r?\n/);
const out = lines.map((line) => {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) return line;
  const key = m[1];
  if (key in replacements) return `${key}=${replacements[key]}`;
  return line;
});

fs.writeFileSync(targetPath, out.join('\n'), 'utf8');

console.log(`已生成 ${targetPath}`);
console.log('  管理员账号：keeper');
console.log(`  管理员密码：${replacements.ADMIN_PASSWORD}`);
console.log(`  WORKER_API_KEY：${replacements.WORKER_API_KEY}`);
console.log('\n请妥善保存以上信息（.env 已被 .gitignore 忽略）。');
