/**
 * 极简日志器（零依赖）
 * - 开发：彩色单行，便于人眼扫
 * - 生产：JSON 单行，便于 journalctl / 日志采集
 * 环境变量 LOG_LEVEL = debug | info | warn | error
 */
import { config } from '../config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLOR: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[90m';

const minLevel: Level = ((): Level => {
  const fromEnv = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (fromEnv === 'debug' || fromEnv === 'info' || fromEnv === 'warn' || fromEnv === 'error') {
    return fromEnv;
  }
  return config.isProd ? 'info' : 'debug';
})();

const useColor = !config.isProd && process.stdout.isTTY === true;

function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    let s: string;
    if (typeof v === 'string') s = v;
    else if (v instanceof Error) s = `${v.name}: ${v.message}`;
    else {
      try {
        s = JSON.stringify(v);
      } catch {
        s = String(v);
      }
    }
    parts.push(`${k}=${s}`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function write(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (WEIGHT[level] < WEIGHT[minLevel]) return;
  const ts = new Date().toISOString();

  if (config.isProd) {
    const line: Record<string, unknown> = { ts, level, msg };
    if (extra) for (const [k, v] of Object.entries(extra)) line[k] = v instanceof Error ? v.message : v;
    const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    out.write(`${JSON.stringify(line)}\n`);
    return;
  }

  const head = useColor
    ? `${DIM}${ts.slice(11, 19)}${RESET} ${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET}`
    : `${ts.slice(11, 19)} ${level.toUpperCase().padEnd(5)}`;
  const tail = useColor ? `${DIM}${formatExtra(extra)}${RESET}` : formatExtra(extra);
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(`${head} ${msg}${tail}\n`);
}

export const logger = {
  level: minLevel,
  debug: (msg: string, extra?: Record<string, unknown>) => write('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
};

/** 记录异常：带堆栈（生产环境只记录 message 与 stack，避免敏感对象） */
export function logError(msg: string, err: unknown, extra?: Record<string, unknown>): void {
  const e = err as Error;
  logger.error(msg, { ...extra, error: e?.message ?? String(err), stack: e?.stack });
}
