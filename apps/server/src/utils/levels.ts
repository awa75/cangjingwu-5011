/**
 * 会员等级（LV1–LV9）共用的小工具
 *
 * 约定：匿名访客按 **0 级** 看待（只看得到 min_level = 1 的内容）；
 * 坞主按 **9 级** 看待（全看）。坞主身份由 .env 的 OWNER_USERNAME 判定，不看数据库。
 */

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 9;
/**
 * 匿名访客的**内容**等级：按 LV1 看待 —— 也就是说 min_level = 1 就是"所有人可见"。
 * （站外按钮另算：那边匿名是 0 级，所以游客看不到任何按钮，见 links/service。）
 */
export const LEVEL_GUEST = 0;
export const LEVEL_EVERYONE = 1;

/** 把任意输入夹到 1..9；非法值用 fallback */
export function clampMinLevel(input: unknown, fallback = LEVEL_MIN): number {
  const v = Number(input);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.trunc(v)));
}

/** 查看者的内容等级：坞主 9，会员按自己等级，匿名 0 */
export function viewerLevel(user: { isOwner: boolean; level: number } | undefined): number {
  if (!user) return LEVEL_GUEST;
  return user.isOwner ? LEVEL_MAX : Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, user.level));
}

/** 查看者对**内容**的等级：未登录按 LV1（LV1 = 所有人可见），坞主 9，会员按自己等级 */
export function contentLevel(user: { isOwner: boolean; level: number } | undefined): number {
  return user ? viewerLevel(user) : LEVEL_EVERYONE;
}

/** 该内容对查看者是否可见 */
export function visibleTo(minLevel: number | undefined, level: number): boolean {
  return (minLevel ?? LEVEL_MIN) <= level;
}
