/**
 * 前后端共享的数据结构定义（DTO）
 *
 * 新站只保留文库用得上的形状。旧站 26.1.1 里的灵石、宠物、人格、记忆、DSH、
 * 知识库、技能、内部密钥、分析任务、音乐、站外按钮、身份绑定，全部已删除。
 */
import type {
  CollectionKind,
  FileKind,
  ReviewStatus,
  ShareTargetType,
  SurveyQuestionKind,
  SurveyStatus,
  Visibility,
} from './enums.js';

/** 统一响应包装：{ code, message, data }。code=0 表示成功 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

/** 分页包装 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 文件（元数据） */
export interface FileItem {
  id: string;
  kind: FileKind;
  originalName: string;
  ext: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  visibility: Visibility;
  /** 最低等级（1..9）：低于它的访客看不到 */
  minLevel: number;
  /** 收录状态：pending 只有投稿人与坞主可见，approved 才对外 */
  reviewStatus: ReviewStatus;
  /** 退回原因（rejected 时有值） */
  reviewNote: string;
  reviewedAt: string | null;
  /** 投稿人 id；坞主自己传的也为自己的 id */
  uploadedBy: string | null;
  /** 投稿人用户名（列表与审核台带上，省一次查询） */
  uploaderName?: string | null;
  hasThumb: boolean;
  createdAt: string;
  updatedAt: string;
  /** 可直接放入 src 的相对地址 */
  rawUrl: string;
  thumbUrl: string;
}

/** 文稿绑定的文件（文库「下载所有文件」的来源；影像即由此成为文稿附件） */
export interface DocumentFileItem {
  id: string;
  fileId: string;
  sortOrder: number;
  createdAt: string;
  file: FileItem | null;
}

/** 文库文件夹（分卷） */
export interface Collection {
  id: string;
  slug: string;
  title: string;
  /** 归属。新站恒为 'library'，保留字段以免改动服务层查询 */
  kind: CollectionKind;
  /** 列表里显示的一句话 */
  summary: string;
  /** 卷首说明（Markdown） */
  descriptionMd: string;
  /** 封面文件 id；为空则由前端取夹内第一篇文稿 */
  coverFileId: string | null;
  coverFile: FileItem | null;
  sortOrder: number;
  visible: boolean;
  /** 最低等级（1..9）：夹内内容也受它约束 */
  minLevel: number;
  /** 夹内可见文稿数 */
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Markdown 文稿 */
export interface DocumentItem {
  id: string;
  slug: string;
  title: string;
  contentMd: string;
  pinned: boolean;
  visible: boolean;
  /** 最低等级（1..9） */
  minLevel: number;
  /** 所属文件夹；null = 未归档 */
  collectionId: string | null;
  /** 手动排序（小的在前）；坞主拖拽后写这个值 */
  sortOrder: number;
  /** 绑定的文件数；0 = 文库条目不显示「下载所有文件」 */
  fileCount: number;
  /** 绑定文件明细（仅详情接口返回） */
  files?: DocumentFileItem[];
  createdAt: string;
  updatedAt: string;
  /** 列表接口不返回正文，此字段为空 */
  excerpt?: string;
}

/** 分享记录 */
export interface ShareItem {
  id: string;
  token: string;
  url: string;
  targetType: ShareTargetType;
  targetId: string;
  targetTitle: string;
  expiresAt: string | null;
  maxViews: number | null;
  views: number;
  revoked: boolean;
  createdAt: string;
  expired: boolean;
}

/** 分享访问时的元数据（免登录） */
export interface ShareResolved {
  token: string;
  targetType: ShareTargetType;
  title: string;
  /** 文件分享：文件 DTO；文档分享：文档 DTO */
  file?: FileItem;
  document?: DocumentItem;
  expiresAt: string | null;
  remainingViews: number | null;
}

/** 站点设置（公开部分） */
export interface SiteSettings {
  site_name: string;
  site_subtitle: string;
  site_tagline: string;
  hero_text: string;
  footer_text: string;
  project_code: string;
  contact: string;
  [key: string]: string;
}

/** 坞主后台概览统计 */
export interface StatsOverview {
  files: {
    total: number;
    byKind: Record<string, number>;
    totalBytes: number;
    /** 待审数量 —— 坞主首页最该看的数 */
    pending: number;
  };
  documents: { total: number };
  collections: { total: number };
  shares: { total: number; active: number };
  storage: {
    diskTotalBytes: number;
    diskFreeBytes: number;
    storageBytes: number;
  };
  system: {
    uptimeSeconds: number;
    nodeVersion: string;
    dbSizeBytes: number;
    ffmpegAvailable: boolean;
  };
}

/** 登录者（前端登录态） */
export interface AuthUser {
  id: string;
  username: string;
  /** 是否坞主 —— 由服务端按 .env 的 OWNER_USERNAME 判定，库里没有角色列 */
  isOwner: boolean;
  /** 等级 1..9；用于内容最低等级 */
  level: number;
  nickname?: string;
  createdAt?: string;
  lastLoginAt?: string | null;
}

/** 登录/注册返回 */
export interface LoginResult {
  token: string;
  expiresIn: string;
  user: AuthUser;
}

/** 注册入参：邀请码 + 用户名 + 密码 */
export interface RegisterInput {
  code: string;
  username: string;
  password: string;
  nickname?: string;
}

/** 邀请码（18 位，三组「3 字母 + 3 数字」连写） */
export interface InviteCode {
  code: string;
  /** 用此码注册后获得的等级 */
  level: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  disabled: boolean;
  note: string;
  createdAt: string;
}

/** 会员（坞主列表项） */
export interface MemberItem {
  id: string;
  username: string;
  nickname: string;
  isOwner: boolean;
  level: number;
  status: 'active' | 'disabled';
  inviteCode: string | null;
  note: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** 投稿数与待审数（坞主一眼看清谁在投） */
  fileCount?: number;
  pendingCount?: number;
}

/* ------------------------------------------------------------------ 问卷 */

/** 答案值：单选/填空/长文本是 string，多选是 string[]，评分是 number */
export type SurveyAnswerValue = string | string[] | number | null;

/** 问卷里的一道题 */
export interface SurveyQuestion {
  id: string;
  kind: SurveyQuestionKind;
  title: string;
  /** 题目下方的浅色提示 */
  hint: string;
  required: boolean;
  /** single / multiple 的选项；其它类型为空数组 */
  options: string[];
  /** rating 的满分（2..10），其它类型无意义 */
  maxRating: number;
  sortOrder: number;
}

/** 问卷（坞主列表项） */
export interface SurveyItem {
  id: string;
  token: string;
  /** 相对路径，形如 /q/<token>；前端拼成完整链接发给别人 */
  path: string;
  title: string;
  descriptionMd: string;
  status: SurveyStatus;
  expiresAt: string | null;
  maxResponses: number | null;
  onePerVisitor: boolean;
  questionCount: number;
  responseCount: number;
  /** 此刻能不能收答卷（关闭 / 过期 / 名额满 → false） */
  accepting: boolean;
  /** 不能收的原因；accepting 为 true 时是空串 */
  closedReason: string;
  createdAt: string;
  updatedAt: string;
}

/** 问卷详情（含题目） */
export interface SurveyDetail extends SurveyItem {
  questions: SurveyQuestion[];
}

/** 一份答卷 */
export interface SurveyResponseItem {
  id: string;
  submittedAt: string;
  answers: { questionId: string; value: SurveyAnswerValue }[];
}

/** 公开问卷（填答页拿到的定义，不含任何统计） */
export interface PublicSurvey {
  title: string;
  descriptionMd: string;
  status: SurveyStatus;
  expiresAt: string | null;
  accepting: boolean;
  closedReason: string;
  questions: SurveyQuestion[];
}
