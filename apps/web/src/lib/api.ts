/**
 * 后端接口客户端（纯文库站）
 * - 统一解包 { code, message, data }，失败抛 ApiError（带 HTTP 状态与业务 code）
 * - 同源请求：开发期由 Vite 代理 /api、/media 到 127.0.0.1:8080；生产由后端同源托管
 * - **登录令牌只存在内存里**（见 hooks/useAuth.tsx）：刷新页面即回到未登录，
 *   这里不再读写 localStorage / sessionStorage，也不留任何持久化痕迹。
 * - 接口路径全部走 @cangjingwu/shared 的 API 常量，不在这里手写字符串
 */
import { API } from '@cangjingwu/shared';
import type {
  ApiResponse,
  AuthUser,
  Collection,
  DocumentFileItem,
  DocumentItem,
  FileItem,
  FileKind,
  InviteCode,
  LoginResult,
  MemberItem,
  Paginated,
  PublicSurvey,
  RegisterInput,
  ReviewStatus,
  ShareItem,
  ShareResolved,
  SiteSettings,
  StatsOverview,
  SurveyAnswerValue,
  SurveyDetail,
  SurveyItem,
  SurveyQuestion,
  SurveyQuestionKind,
  SurveyResponseItem,
  Visibility,
} from '@cangjingwu/shared';

/* ------------------------------------------------------------------ 内存令牌 */

/**
 * 令牌源：**只在内存里**。
 * 页面刷新 / 关标签页 = 令牌消失 = 回到未登录，这是刻意的设计。
 */
let token: string | null = null;

export const auth = {
  get token(): string | null {
    return token;
  },
  set(next: string) {
    token = next;
  },
  clear() {
    token = null;
  },
};

export class ApiError extends Error {
  code: number;
  status: number;
  constructor(message: string, code: number, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 401 时通知上层（AuthProvider 用它清登录态并跳登录页） */
const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError('无法连接后端服务，请确认它正在运行', -1, 0);
  }

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    payload = null;
  }

  if (res.status === 401) {
    token = null;
    unauthorizedListeners.forEach((fn) => fn());
  }

  if (!res.ok || !payload || payload.code !== 0) {
    const message = payload?.message ?? `请求失败（HTTP ${res.status}）`;
    throw new ApiError(message, payload?.code ?? res.status, res.status);
  }
  return payload.data as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

/** 免登录的媒体直读地址（已收录 + 公开的文件才出得来） */
export const media = {
  thumb: (fileId: string) => API.media.thumbs(fileId),
  raw: (fileId: string) => API.media.files(fileId),
  /** 登录态读自己投的私有文件 */
  fileRaw: (fileId: string) => API.files.raw(fileId),
};

/* ------------------------------------------------------------------ 免登录只读 */

export const publicApi = {
  /** 站点文案（站名 / 题记 / 首页说明 / 页脚 / 联系方式） */
  site: () => request<SiteSettings>(API.public.site),

  /** 文库文件夹列表（含"未归档"计数） */
  collections: () =>
    request<{ items: Collection[]; total: number; unassigned: number; kind: string }>(
      API.public.collections,
    ),

  /** 文库文稿列表（不含正文） */
  documents: () => request<{ items: DocumentItem[]; total: number }>(API.public.documents),

  /** 文库「影像」区：已收录的图片 / 视频 / 音频 */
  media: () => request<{ items: FileItem[]; total: number }>(API.public.media),

  /** 按 slug 读单篇（含正文） */
  document: (slug: string) => request<DocumentItem>(API.public.document(slug)),

  /** 某篇文稿绑定的文件清单 */
  documentFiles: (slug: string) =>
    request<{ items: DocumentFileItem[]; total: number }>(API.public.documentFiles(slug)),

  /** 打包下载地址（直接丢给 <a href>） */
  documentZipUrl: (slug: string) => API.public.documentZip(slug),
};

/* ------------------------------------------------------------------ 鉴权 */

export const authApi = {
  login: (username: string, password: string) =>
    request<LoginResult>(API.auth.login, { method: 'POST', ...json({ username, password }) }),
  register: (input: RegisterInput) =>
    request<LoginResult>(API.auth.register, { method: 'POST', ...json(input) }),
  me: () => request<AuthUser>(API.auth.me),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<null>(API.auth.password, { method: 'POST', ...json({ oldPassword, newPassword }) }),
};

/* ------------------------------------------------------------------ 文件 */

export interface UploadLimits {
  maxBytes: number;
  maxFiles: number;
  acceptedExtensions: string[];
}

export interface FileQuery {
  kind?: FileKind | '';
  visibility?: Visibility | '';
  /** 收录状态过滤（仅坞主有效；会员一律只看得到自己投的） */
  review?: ReviewStatus | '';
  /** 按投稿人过滤（仅坞主有效） */
  uploadedBy?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** 各收录状态的数量（审核台顶部计数） */
export type ReviewCounts = Record<ReviewStatus, number>;

export const filesApi = {
  limits: () => request<UploadLimits>(API.files.limits),

  list: (q: FileQuery = {}) => {
    const sp = new URLSearchParams();
    if (q.kind) sp.set('kind', q.kind);
    if (q.visibility) sp.set('visibility', q.visibility);
    if (q.review) sp.set('review', q.review);
    if (q.uploadedBy) sp.set('uploadedBy', q.uploadedBy);
    if (q.q) sp.set('q', q.q);
    sp.set('page', String(q.page ?? 1));
    sp.set('pageSize', String(q.pageSize ?? 60));
    return request<Paginated<FileItem>>(`${API.files.root}?${sp.toString()}`);
  },

  /** 各收录状态的数量 */
  reviewCounts: () => request<ReviewCounts>(`${API.files.root}/meta/review`),

  /** 坞主放行 / 退回（退回可附一句原因） */
  review: (id: string, action: 'approve' | 'reject', note?: string) =>
    request<FileItem>(API.files.review(id), {
      method: 'PATCH',
      ...json({ action, note: note ?? '' }),
    }),

  /**
   * 换一条 120 秒的预览直链（本人或坞主）。
   * <img>/<video> 带不上 Authorization，公开的 /media 又对未收录文件 403，
   * 所以先换票、再交给标签自己加载 —— 底层 sendFile 支持 Range，视频可拖进度条。
   */
  previewTicket: (id: string) =>
    request<{ url: string; expiresInSeconds: number }>(API.files.previewTicket(id), { method: 'POST' }),

  patch: (id: string, body: { originalName?: string; visibility?: Visibility; minLevel?: number }) =>
    request<FileItem>(API.files.byId(id), { method: 'PATCH', ...json(body) }),

  remove: (id: string, purge = false) =>
    request<null>(`${API.files.byId(id)}${purge ? '?purge=1' : ''}`, { method: 'DELETE' }),

  /**
   * 上传（XHR 才能拿到进度；fetch 目前拿不到上传进度）
   * onProgress 收到 0–100 的整体百分比
   */
  upload(files: File[], onProgress?: (percent: number) => void): Promise<FileItem[]> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      files.forEach((f) => form.append('file', f, f.name));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', API.files.upload);
      // 令牌只在内存里，这里现取现用（不会落盘）
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        let payload: ApiResponse<FileItem[]> | null = null;
        try {
          payload = JSON.parse(xhr.responseText) as ApiResponse<FileItem[]>;
        } catch {
          payload = null;
        }
        if (xhr.status === 401) {
          token = null;
          unauthorizedListeners.forEach((fn) => fn());
        }
        if (xhr.status >= 200 && xhr.status < 300 && payload?.code === 0) {
          resolve(payload.data as FileItem[]);
        } else {
          reject(
            new ApiError(payload?.message ?? `上传失败（HTTP ${xhr.status}）`, payload?.code ?? xhr.status, xhr.status),
          );
        }
      };
      xhr.onerror = () => reject(new ApiError('上传中断：网络错误', -1, 0));
      xhr.ontimeout = () => reject(new ApiError('上传超时', -1, 0));
      xhr.send(form);
    });
  },
};

/* ------------------------------------------------------------------ 文库文件夹（坞主可写） */

export const collectionsApi = {
  list: () => request<{ items: Collection[]; total: number }>(API.collections.root),
  create: (body: {
    title: string;
    slug?: string;
    summary?: string;
    descriptionMd?: string;
    coverFileId?: string | null;
    sortOrder?: number;
    visible?: boolean;
    minLevel?: number;
  }) => request<Collection>(API.collections.root, { method: 'POST', ...json(body) }),
  update: (
    id: string,
    body: Partial<
      Pick<
        Collection,
        'title' | 'slug' | 'summary' | 'descriptionMd' | 'coverFileId' | 'sortOrder' | 'visible' | 'minLevel'
      >
    >,
  ) => request<Collection>(API.collections.byId(id), { method: 'PUT', ...json(body) }),
  /** 批量重排（拖拽后一次提交） */
  reorder: (items: { id: string }[]) =>
    request<{ reordered: number }>(API.collections.reorder, { method: 'PATCH', ...json({ items }) }),
  remove: (id: string) =>
    request<{ removed: string; orphaned: number }>(API.collections.byId(id), { method: 'DELETE' }),
};

/* ------------------------------------------------------------------ 文稿（坞主） */

export interface DocumentInput {
  title?: string;
  slug?: string;
  contentMd?: string;
  pinned?: boolean;
  visible?: boolean;
  minLevel?: number;
  collectionId?: string | null;
  sortOrder?: number;
}

export const documentsApi = {
  list: (withContent = false) =>
    request<{ items: DocumentItem[]; total: number }>(
      `${API.documents.root}${withContent ? '?withContent=1' : ''}`,
    ),
  get: (id: string) => request<DocumentItem>(API.documents.byId(id)),
  create: (body: DocumentInput & { title: string }) =>
    request<DocumentItem>(API.documents.root, { method: 'POST', ...json(body) }),
  update: (id: string, body: DocumentInput) =>
    request<DocumentItem>(API.documents.byId(id), { method: 'PUT', ...json(body) }),
  remove: (id: string) => request<null>(API.documents.byId(id), { method: 'DELETE' }),
  setPin: (id: string, pinned: boolean) =>
    request<DocumentItem>(API.documents.pin(id), { method: 'PATCH', ...json({ pinned }) }),
  /** 批量重排 / 批量改归属（拖拽） */
  reorder: (items: { id: string; collectionId?: string | null }[]) =>
    request<{ reordered: number }>(API.documents.reorder, { method: 'PATCH', ...json({ items }) }),

  /** 绑定文件（文库「下载所有文件」的来源） */
  listFiles: (id: string) => request<{ items: DocumentFileItem[]; total: number }>(API.documents.files(id)),
  bindFile: (id: string, fileId: string) =>
    request<DocumentFileItem>(API.documents.files(id), { method: 'POST', ...json({ fileId }) }),
  unbindFile: (id: string, fileId: string) =>
    request<null>(API.documents.file(id, fileId), { method: 'DELETE' }),
};

/* ------------------------------------------------------------------ 分享（登录态） */

export const sharesApi = {
  list: () => request<{ items: ShareItem[]; total: number }>(API.shares.root),
  create: (body: {
    targetType: 'file' | 'document';
    targetId: string;
    expiresInHours?: number | null;
    maxViews?: number | null;
  }) => request<ShareItem>(API.shares.root, { method: 'POST', ...json(body) }),
  revoke: (id: string) => request<null>(API.shares.byId(id), { method: 'DELETE' }),
  /** 免登录：分享页元数据（每次调用计一次访问） */
  resolve: (token: string) => request<ShareResolved>(API.share.meta(token)),
  rawUrl: (token: string) => API.share.raw(token),
};

/* ------------------------------------------------------------------ 问卷 */

/** 新建 / 编辑问卷时提交的题目形状（编辑已有题目要带上 id，否则会被当成新题） */
export interface SurveyQuestionInput {
  id?: string;
  kind: SurveyQuestionKind;
  title: string;
  hint?: string;
  required?: boolean;
  options?: string[];
  maxRating?: number;
}

export interface SurveyInput {
  title?: string;
  descriptionMd?: string;
  status?: 'open' | 'closed';
  expiresAt?: string | null;
  maxResponses?: number | null;
  onePerVisitor?: boolean;
  questions?: SurveyQuestionInput[];
}

export const surveysApi = {
  list: () => request<{ items: SurveyItem[]; total: number }>(API.owner.surveys),
  get: (id: string) => request<SurveyDetail>(API.owner.survey(id)),
  create: (body: SurveyInput & { title: string; questions: SurveyQuestionInput[] }) =>
    request<SurveyDetail>(API.owner.surveys, { method: 'POST', ...json(body) }),
  update: (id: string, body: SurveyInput) =>
    request<SurveyDetail>(API.owner.survey(id), { method: 'PUT', ...json(body) }),
  remove: (id: string) => request<{ removed: string }>(API.owner.survey(id), { method: 'DELETE' }),
  /** 换新链接，旧链接立刻失效 */
  rotate: (id: string) => request<SurveyDetail>(API.owner.surveyRotate(id), { method: 'POST' }),
  responses: (id: string) =>
    request<{ items: SurveyResponseItem[]; total: number }>(API.owner.surveyResponses(id)),

  /**
   * 导出 CSV。
   * 不能直接给 <a href>：该接口要坞主令牌，链接带不上 Authorization。
   * 所以先带凭证取 blob，再由调用方用 object URL 触发下载。
   */
  async exportCsv(id: string): Promise<Blob> {
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(API.owner.surveyExport(id), { headers });
    if (!res.ok) {
      let message = `导出失败（HTTP ${res.status}）`;
      try {
        const payload = (await res.json()) as ApiResponse<null>;
        message = payload?.message ?? message;
      } catch {
        /* 非 JSON 响应，保留默认文案 */
      }
      throw new ApiError(message, res.status, res.status);
    }
    return res.blob();
  },

  /* ---- 免登录填答 ---- */
  open: (token: string) => request<PublicSurvey>(API.survey.meta(token)),
  submit: (token: string, answers: Record<string, SurveyAnswerValue>) =>
    request<{ submittedAt: string }>(API.survey.submit(token), {
      method: 'POST',
      ...json({ answers }),
    }),
  pagePath: (token: string) => API.survey.page(token),
};

/* ------------------------------------------------------------------ 坞主专属 */

export interface InviteCodeInput {
  count?: number;
  level?: number;
  maxUses?: number;
  expiresAt?: string | null;
  note?: string;
}

export const ownerApi = {
  stats: () => request<StatsOverview>(API.owner.stats),

  /** 站点文案读写 */
  settings: () => request<SiteSettings>(API.owner.settings),
  saveSettings: (body: Partial<SiteSettings>) =>
    request<SiteSettings>(API.owner.settings, { method: 'PATCH', ...json(body) }),

  /** 邀请码 */
  codes: () => request<{ items: InviteCode[] }>(API.owner.codes),
  createCodes: (body: InviteCodeInput) =>
    request<{ items: InviteCode[] }>(API.owner.codes, { method: 'POST', ...json(body) }),
  updateCode: (code: string, body: Partial<InviteCode>) =>
    request<InviteCode>(API.owner.code(code), { method: 'PATCH', ...json(body) }),
  removeCode: (code: string) => request<null>(API.owner.code(code), { method: 'DELETE' }),
  disableAllCodes: () =>
    request<{ disabled: number }>(API.owner.codesDisableAll, { method: 'POST' }),

  /** 会员 */
  members: () => request<{ items: MemberItem[] }>(API.owner.members),
  updateMember: (id: string, body: Partial<MemberItem>) =>
    request<MemberItem>(API.owner.member(id), { method: 'PATCH', ...json(body) }),
  resetMemberPassword: (id: string, password: string) =>
    request<null>(API.owner.memberPassword(id), { method: 'POST', ...json({ password }) }),
};

export type {
  AuthUser,
  Collection,
  DocumentFileItem,
  DocumentItem,
  FileItem,
  InviteCode,
  MemberItem,
  PublicSurvey,
  ReviewStatus,
  ShareItem,
  SiteSettings,
  StatsOverview,
  SurveyAnswerValue,
  SurveyDetail,
  SurveyItem,
  SurveyQuestion,
  SurveyQuestionKind,
  SurveyResponseItem,
  Visibility,
};
