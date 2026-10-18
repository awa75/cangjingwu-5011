/**
 * API 路径常量：前后端共用，避免字符串写歪
 *
 * 分组说明：
 *   auth/files/collections/documents/shares  —— 需登录（files.upload 任何登录者可用，其余看归属）
 *   owner/*                                  —— 坞主专属（建文稿、建文件夹、审收录、发邀请码）
 *   public/*                                 —— 免登录只读
 */
export const API = {
  health: '/api/health',

  auth: {
    login: '/api/auth/login',
    /** 会员注册：邀请码 + 用户名 + 密码 */
    register: '/api/auth/register',
    me: '/api/auth/me',
    password: '/api/auth/password',
  },

  files: {
    root: '/api/files',
    /** 任何登录者都能投稿；入库即 pending，等坞主放行 */
    upload: '/api/files/upload',
    byId: (id: string) => `/api/files/${id}`,
    /** 私有文件预览（需登录且是自己或坞主） */
    raw: (id: string) => `/api/files/${id}/raw`,
    limits: '/api/files/meta/limits',
    /** 坞主放行 / 退回：body { action: 'approve' | 'reject', note? } */
    review: (id: string) => `/api/files/${id}/review`,
    /**
     * 审核预览票（POST，本人或坞主）→ { url, expiresInSeconds }
     *
     * 为什么要票：<img>/<video> 带不上 Authorization 头，而公开的 /media/* 对
     * 未收录文件一律 403 —— 审核台就会看不见内容。票是 120 秒、只对这一个文件
     * 有效的一次性地址，即使被日志记下也很快失效，且不泄露登录令牌本身。
     */
    previewTicket: (id: string) => `/api/files/${id}/preview-ticket`,
  },

  /** 文库文件夹（坞主可写，公开读取走 public.collections） */
  collections: {
    root: '/api/collections',
    byId: (id: string) => `/api/collections/${id}`,
    reorder: '/api/collections/reorder',
  },

  /** Markdown 文稿（坞主可写，公开读取走 public.documents） */
  documents: {
    root: '/api/documents',
    byId: (id: string) => `/api/documents/${id}`,
    pin: (id: string) => `/api/documents/${id}/pin`,
    /** 批量重排 / 批量改归属（拖拽后一次提交） */
    reorder: '/api/documents/reorder',
    /** 文稿绑定的文件 */
    files: (id: string) => `/api/documents/${id}/files`,
    file: (id: string, fileId: string) => `/api/documents/${id}/files/${fileId}`,
  },

  shares: {
    root: '/api/shares',
    byId: (id: string) => `/api/shares/${id}`,
  },

  public: {
    collections: '/api/public/collections',
    documents: '/api/public/documents',
    document: (slug: string) => `/api/public/documents/${slug}`,
    /** 文稿绑定文件清单（免登录） */
    documentFiles: (slug: string) => `/api/public/documents/${slug}/files`,
    /** 打包下载该文稿的全部绑定文件 */
    documentZip: (slug: string) => `/api/public/documents/${slug}/download`,
    site: '/api/public/site',
    /** 文库「影像」区：已收录的图片 / 视频 / 音频 */
    media: '/api/public/media',
  },

  share: {
    meta: (token: string) => `/api/s/${token}`,
    raw: (token: string) => `/api/s/${token}/raw`,
  },

  /**
   * 问卷填答（**免登录**，凭 token）
   * 令牌只由坞主分发；站内不出现任何入口，猜不到就打不开。
   */
  survey: {
    /** 取问卷定义（同时下发一个访客 cookie，用于「同一浏览器一份」） */
    meta: (token: string) => `/api/q/${token}`,
    submit: (token: string) => `/api/q/${token}/submit`,
    /** 前端路由路径（拼成完整链接发给别人） */
    page: (token: string) => `/q/${token}`,
  },

  /** 预览票换来的直链：免登录头，120 秒有效，只对票里那一个文件生效 */
  preview: (token: string) => `/api/preview/${token}`,

  /** 坞主专属：替代旧站那 21 页管理后台 */
  owner: {
    stats: '/api/owner/stats',
    settings: '/api/owner/settings',

    /** 邀请码 */
    codes: '/api/owner/codes',
    code: (code: string) => `/api/owner/codes/${encodeURIComponent(code)}`,
    codesDisableAll: '/api/owner/codes/disable-all',

    /** 会员 */
    members: '/api/owner/members',
    member: (id: string) => `/api/owner/members/${id}`,
    memberPassword: (id: string) => `/api/owner/members/${id}/password`,

    /** 问卷（坞主专属管理；填答走 survey.*） */
    surveys: '/api/owner/surveys',
    survey: (id: string) => `/api/owner/surveys/${id}`,
    /** 换一条新令牌，旧链接立刻失效 */
    surveyRotate: (id: string) => `/api/owner/surveys/${id}/rotate`,
    surveyResponses: (id: string) => `/api/owner/surveys/${id}/responses`,
    surveyExport: (id: string) => `/api/owner/surveys/${id}/export.csv`,
  },

  /** 媒体出图出片（免登录，带可见性与收录校验） */
  media: {
    thumbs: (id: string) => `/media/thumbs/${id}`,
    files: (id: string) => `/media/files/${id}`,
  },
} as const;
