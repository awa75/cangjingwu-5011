/**
 * 站点设置（key-value）
 */
import { all, run } from '../../db/index.js';
import { PUBLIC_SETTING_KEYS, type SiteSettings } from '@cangjingwu/shared';
import { nowIso } from '../../utils/ids.js';
import { ApiError } from '../../utils/response.js';

/** 读取全部设置 */
export function getSettings(): Record<string, string> {
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** 仅公开字段（免登录接口用） */
export function getPublicSettings(): SiteSettings {
  const allSettings = getSettings();
  const out: Record<string, string> = {};
  for (const key of PUBLIC_SETTING_KEYS) out[key] = allSettings[key] ?? '';
  if (!out.site_name) out.site_name = '藏经坞';
  return out as SiteSettings;
}

/** 批量写入（只接受字符串值；未知键也允许，便于扩展文案） */
export function setSettings(patch: Record<string, unknown>): Record<string, string> {
  const entries = Object.entries(patch);
  if (entries.length === 0) throw ApiError.badRequest('没有需要更新的设置');

  for (const [key, value] of entries) {
    if (typeof value !== 'string') throw ApiError.badRequest(`设置项 ${key} 必须是字符串`);
    if (key.length > 64) throw ApiError.badRequest('设置键过长');
    if (value.length > 20_000) throw ApiError.badRequest(`设置项 ${key} 内容过长`);
    run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      nowIso(),
    );
  }
  return getSettings();
}
