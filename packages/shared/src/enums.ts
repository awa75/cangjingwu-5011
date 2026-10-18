/**
 * 全局枚举与常量（前后端共享）
 * 约定：所有枚举值都是小写字符串，直接落库、直接进 JSON、直接对应 CSS class
 */

/** 文件大类：决定存储子目录与前端渲染方式 */
export const FileKind = {
  Image: 'image',
  Video: 'video',
  Audio: 'audio',
  Doc: 'doc',
  Other: 'other',
} as const;
export type FileKind = (typeof FileKind)[keyof typeof FileKind];
export const FILE_KINDS: FileKind[] = ['image', 'video', 'audio', 'doc', 'other'];

/** 可见性：public 的文件可直接经 /media 出图，private 需登录或持分享令牌 */
export const Visibility = {
  Public: 'public',
  Private: 'private',
} as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

/**
 * 收录状态（先审后公开）
 *
 *   pending  —— 刚投稿，只有投稿人自己和坞主看得到
 *   approved —— 坞主放行，进入文库，任何人可读
 *   rejected —— 坞主退回，只有投稿人与坞主看得到（带 review_note 说明原因）
 */
export const ReviewStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];
export const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected'];

/** 分享目标类型 */
export const ShareTargetType = {
  File: 'file',
  Document: 'document',
} as const;
export type ShareTargetType = (typeof ShareTargetType)[keyof typeof ShareTargetType];

/**
 * 文件夹归属。新站只有文库一种，此枚举保留是为了不改动服务层的查询签名。
 */
export const CollectionKind = {
  Library: 'library',
} as const;
export type CollectionKind = (typeof CollectionKind)[keyof typeof CollectionKind];
export const COLLECTION_KINDS: CollectionKind[] = ['library'];

/** 本站内置主题（详见 docs/02-视觉与主题.md）；风格库那几十套在 apps/web 里，不走这里 */
export const ThemeId = {
  Paper: 'paper',
  Ink: 'ink',
} as const;
export type ThemeId = (typeof ThemeId)[keyof typeof ThemeId];
export const THEMES: ThemeId[] = ['paper', 'ink'];

/** 站点设置里可公开读取的键 */
export const PUBLIC_SETTING_KEYS = [
  'site_name',
  'site_subtitle',
  'site_tagline',
  'hero_text',
  'footer_text',
  'project_code',
  'contact',
] as const;
export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number];

/**
 * 问卷题目类型
 *
 *   single    单选（选项里挑一个）
 *   multiple  多选
 *   text      单行填空
 *   paragraph 多行长文本
 *   rating    N 分评分（默认 5 分制，右端为高分）
 */
export const SurveyQuestionKind = {
  Single: 'single',
  Multiple: 'multiple',
  Text: 'text',
  Paragraph: 'paragraph',
  Rating: 'rating',
} as const;
export type SurveyQuestionKind = (typeof SurveyQuestionKind)[keyof typeof SurveyQuestionKind];
export const SURVEY_QUESTION_KINDS: SurveyQuestionKind[] = [
  'single',
  'multiple',
  'text',
  'paragraph',
  'rating',
];

/** 问卷状态：closed 之后即使有链接也不能再提交 */
export const SurveyStatus = {
  Open: 'open',
  Closed: 'closed',
} as const;
export type SurveyStatus = (typeof SurveyStatus)[keyof typeof SurveyStatus];
export const SURVEY_STATUSES: SurveyStatus[] = ['open', 'closed'];
