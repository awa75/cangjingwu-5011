#!/usr/bin/env node
/**
 * 密钥占位串守卫自检
 *
 * 背景：`.env.example` 里那几个示例串**长度都够**，能通过"至少 32 字符"的老校验，
 * 于是照抄示例文件也能"正常启动"——拿着一个人人皆知的密钥在跑。
 * 2026 年那次上线就真的踩了：安装脚本随机生成了 JWT / WORKER 密钥，**漏了 AI_KEY_SECRET**。
 *
 * 这个脚本用**真的起一遍服务**来验证守卫（不是读代码猜）：
 *   A. JWT_SECRET 是示例串 → 生产环境拒绝启动（任何人可伪造管理员令牌）
 *   B. WORKER_API_KEY 是示例串 → 生产环境拒绝启动（任何人可伪装成分析机领任务）
 *   C. AI_KEY_SECRET 是示例串 → **照常启动**，但必须大声打印警告
 *      （它泄露的是"库里的 Key 密文可被解开"，不像 JWT 那样能直接冒充管理员；
 *        而且老机器可能正带着占位串在跑，改成致命错误会让它们一重启就起不来）
 *   D. 三个都是随机值 → 启动且**一句警告都没有**
 *
 * 用法：node scripts/secret-guard-check.mjs
 * 退出码：0 全通过；1 有失败
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'apps', 'server');

const PLACEHOLDER_JWT = 'please-generate-a-random-secret-at-least-32-chars';
const PLACEHOLDER_WORKER = 'please-generate-a-worker-api-key-32-bytes';
const PLACEHOLDER_AI = 'please-generate-a-random-secret-at-least-32-chars';
const REAL_JWT = `Xk9${'aB3'.repeat(16)}`;
const REAL_WORKER = `7f${'0d5c'.repeat(16)}`;
const REAL_AI = `Qz8${'mN4'.repeat(16)}`;

const results = [];

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

/**
 * 起一次真实服务，观察它是"拒绝启动"还是"活着并打印警告"。
 * 端口用 0（系统随便挑一个空闲端口），DATA_DIR 用临时目录 —— 绝不碰真实数据库。
 */
function runCase({ name, env, expectExit, expectText, expectAbsent }) {
  return new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cjw-secret-guard-'));
    // ENV_FILE 必须**存在**（config.ts 会拒绝指向不存在的文件），内容空着就行：
    // 我们要的正是"只有环境变量、没有 .env 影响"的干净场景。
    const emptyEnv = path.join(tmp, 'empty.env');
    fs.writeFileSync(emptyEnv, '# 故意留空\n', 'utf8');
    const child = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/index.ts'],
      {
        cwd: SERVER_DIR,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: '0',
          DATA_DIR: path.join(tmp, 'data'),
          STORAGE_DIR: path.join(tmp, 'storage'),
          ENV_FILE: emptyEnv,
          ADMIN_PASSWORD: 'guard-test-admin-pass-1',
          JWT_SECRET: REAL_JWT,
          WORKER_API_KEY: REAL_WORKER,
          AI_KEY_SECRET: REAL_AI,
          DSH_AGENT_ENABLED: '0',
          MEDIA_ENABLED: '0',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
    });

    let settled = false;
    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* 已经退了 */
      }
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* Windows 上偶发占用，忽略 */
      }
      results.push({ name, ok, detail });
      log(`${ok ? '  ✅' : '  ❌'} ${name}${ok ? '' : ` —— ${detail}`}`);
      resolve();
    };

    const timer = setTimeout(() => {
      // 到点还活着 = 它选择"照常启动"
      const hit = expectText ? out.includes(expectText) : true;
      const absentHit = expectAbsent ? out.includes(expectAbsent) : false;
      if (!expectExit) {
        if (!hit) return finish(false, `活着，但输出里没有「${expectText}」`);
        if (absentHit) return finish(false, `活着，但不该出现「${expectAbsent}」却出现了`);
        return finish(true, '照常启动');
      }
      finish(false, `预期拒绝启动（退出码非 0），但它一直活着`);
    }, 6000);

    child.on('exit', (code) => {
      if (settled) return;
      if (!expectExit) return finish(false, `预期照常启动，却退出了（code=${code}）`);
      if (code === 0) return finish(false, '预期拒绝启动，却以 0 退出');
      if (expectText && !out.includes(expectText)) {
        return finish(false, `退出了（code=${code}），但输出里没有「${expectText}」`);
      }
      finish(true, `拒绝启动（code=${code}）`);
    });

    child.on('error', (err) => finish(false, `起不来：${err.message}`));
  });
}

log('\n[密钥占位串守卫] 用真实启动验证（端口 0，临时数据目录，不碰真实库）\n');

await runCase({
  name: 'A. JWT_SECRET 是示例串 → 生产环境拒绝启动',
  env: { JWT_SECRET: PLACEHOLDER_JWT },
  expectExit: true,
  expectText: 'JWT_SECRET',
});

await runCase({
  name: 'B. WORKER_API_KEY 是示例串 → 生产环境拒绝启动',
  env: { WORKER_API_KEY: PLACEHOLDER_WORKER },
  expectExit: true,
  expectText: 'WORKER_API_KEY',
});

await runCase({
  name: 'C. AI_KEY_SECRET 是示例串 → 照常启动，但必须大声警告',
  env: { AI_KEY_SECRET: PLACEHOLDER_AI },
  expectExit: false,
  expectText: 'AI_KEY_SECRET',
});

await runCase({
  name: 'D. 三个都是随机值 → 启动且没有任何配置警告',
  env: {},
  expectExit: false,
  expectAbsent: '配置警告',
});

const failed = results.filter((r) => !r.ok);
log(
  `\n${failed.length === 0 ? '✅' : '❌'} 密钥占位串守卫：${results.length - failed.length}/${results.length} 通过\n`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
