/**
 * 初始化数据：
 * 1. 坞主账号（用户名/密码从 .env 读取；已存在则不覆盖密码）
 * 2. 站点文案默认值
 *
 * 旧站还有一个 seedManualDocument()，会凭空造一篇 is_manual=1 的「项目说明书」。
 * 说明页已废，这里不再创建 —— 否则空库一启动就会自己长出一页要删的东西。
 */
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { newId, nowIso } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import { get, run } from './index.js';

const DEFAULT_SETTINGS: Record<string, string> = {
  site_name: config.siteName,
  site_subtitle: 'ZSR·DCM 协议养护计划',
  site_tagline: '收存所护，以契为凭',
  hero_text: '此处收存《藏经坞：ZSR·DCM 协议养护计划（2026–2030）》全部影像、文稿与推演记录。',
  footer_text: '藏经坞 · 数据不出坞',
  project_code: 'DCM-2026',
  contact: '',
};

/** 初始化坞主：只在不存在时创建，避免每次启动覆盖密码 */
export function seedOwner(): void {
  const existing = get<{ id: string; username: string }>('SELECT id, username FROM users LIMIT 1');
  if (existing) {
    if (existing.username !== config.owner.username) {
      // 不致命，但要让运维一眼看见：.env 的坞主名与库里的第一行对不上，
      // 结果是「谁也不是坞主」，编辑与审核入口会全部消失。
      logger.warn(
        `库中已存在用户「${existing.username}」，与 .env 的 OWNER_USERNAME「${config.owner.username}」不一致；` +
          '坞主权限按 .env 判定，请确认你要的是哪一个',
      );
    } else {
      logger.info(`坞主账号已存在：${existing.username}（跳过创建）`);
    }
    return;
  }

  const hash = config.owner.passwordHash || bcrypt.hashSync(config.owner.password, 12);
  run(
    'INSERT INTO users (id, username, password_hash, level, created_at) VALUES (?, ?, ?, ?, ?)',
    newId('user'),
    config.owner.username,
    hash,
    9,
    nowIso(),
  );
  logger.info(`已创建坞主账号：${config.owner.username}`);
}

/** 站点设置默认值：只补缺失的键，不覆盖已改内容 */
export function seedSettings(): void {
  const now = nowIso();
  let created = 0;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const row = get<{ key: string }>('SELECT key FROM settings WHERE key = ?', key);
    if (row) continue;
    run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', key, value, now);
    created += 1;
  }
  if (created > 0) logger.info(`已写入 ${created} 条站点文案默认值`);
}

/** 一次性执行全部初始化 */
export function seed(): void {
  seedOwner();
  seedSettings();
}
