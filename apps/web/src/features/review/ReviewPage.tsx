/**
 * 坞主审核台（/review）
 *
 * 新站是「先审后公开」：任何人投的稿进来都是 pending，只有坞主放行（approved）
 * 才进入文库对外可见；退回（rejected）会带上原因，只有投稿人与坞主看得到。
 *
 * 这里只做一件事：把待审的投稿一条条看过去，然后「收录」或「退回」。
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { FileItem, ReviewStatus } from '@cangjingwu/shared';
import { filesApi } from '@/lib/api';
import { formatBytes, formatDateTime, kindLabel } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState, ErrorBox, Loading, PageHeader } from '@/components/Bits';
import { FileThumb } from '@/components/FileThumb';
import { useToast } from '@/components/Toast';

const TABS: { value: ReviewStatus; label: string }[] = [
  { value: 'pending', label: '待审' },
  { value: 'approved', label: '已收录' },
  { value: 'rejected', label: '已退回' },
];

const EMPTY_TEXT: Record<ReviewStatus, string> = {
  pending: '没有待审的投稿',
  approved: '还没有收录过投稿',
  rejected: '还没有退回的投稿',
};

export function ReviewPage() {
  const { user, isOwner, ready } = useAuth();
  const location = useLocation();
  const { push } = useToast();

  const [tab, setTab] = useState<ReviewStatus>('pending');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // 坞主走服务端的 review 过滤参数；后端若还没实现该参数，兜底再拉一次全量、前端过滤。
  // pageSize 上限是服务端的 100（utils/response.ts 的 parsePaging），不要传更大。
  const { data, loading, error, reload } = useAsync(
    () => (isOwner ? filesApi.list({ review: tab, pageSize: 100 }) : Promise.resolve(null)),
    [isOwner, tab],
  );

  /** 服务端没按 review 过滤时（第一页里一条本状态的都没有），退回到全量再筛 */
  const fallback = useAsync(
    () => {
      if (!isOwner) return Promise.resolve(null);
      const first = data;
      if (!first || first.items.some((f) => f.reviewStatus === tab)) return Promise.resolve(null);
      if (first.total <= first.items.length) return Promise.resolve(null);
      return filesApi.list({ pageSize: 100 });
    },
    [isOwner, tab, data],
  );

  if (!ready) return <Loading text="验契中…" />;

  if (!user || !isOwner) {
    return (
      <div className="container page">
        <div className="notice">
          审核台是坞主的工具。
          {user ? (
            <>
              当前身份为 {user.username}（LV{user.level}）。
            </>
          ) : (
            <>
              <Link to={`/login?redirect=${encodeURIComponent(location.pathname)}`}>先登录 ›</Link>
            </>
          )}
        </div>
      </div>
    );
  }

  // 服务端已过滤时这里原样返回；没过滤时由上面的兜底再筛一次
  const source = fallback.data ?? data;
  const items: FileItem[] = source ? source.items.filter((f) => f.reviewStatus === tab) : [];

  const decide = async (file: FileItem, action: 'approve' | 'reject', reason = '') => {
    setBusyId(file.id);
    try {
      await filesApi.review(file.id, action, reason);
      push(action === 'approve' ? `已收录「${file.originalName}」` : `已退回「${file.originalName}」`, 'ok');
      setRejectingId(null);
      setNote('');
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '操作失败', 'err');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container page">
      <PageHeader
        title="审核台"
        code="卷四 ·"
        subtitle="投稿先入待审；放行后进入文库对外可见，退回可附一句原因"
        extra={<span className="tag">{data ? `${items.length} 条` : '—'}</span>}
      />

      <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`btn btn-sm${tab === t.value ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => {
              setTab(t.value);
              setRejectingId(null);
              setNote('');
            }}
          >
            {t.label}
          </button>
        ))}
        {tab === 'pending' && items.length > 0 && (
          <span className="notice" style={{ padding: '4px 12px' }}>
            待审 {items.length} 条
          </span>
        )}
      </div>

      {loading && <Loading text="翻检中…" />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {!loading && !error && items.length === 0 && <EmptyState title={EMPTY_TEXT[tab]} />}

      {!loading && !error && items.length > 0 && (
        <ul className="doc-list">
          {items.map((file) => (
            <li key={file.id} className="card" style={{ padding: 'var(--sp-4)' }}>
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 'var(--sp-4)' }}>
                <FileThumb file={file} />

                <div className="stack" style={{ flex: '1 1 auto', minWidth: 0, gap: 6 }}>
                  <strong className="mono" style={{ wordBreak: 'break-all' }}>
                    {file.originalName}
                  </strong>
                  <span className="dim mono" style={{ fontSize: 12 }}>
                    {kindLabel(file.kind)} · {formatBytes(file.size)} · 投稿人{' '}
                    {file.uploaderName || '（未知）'} · {formatDateTime(file.createdAt)}
                  </span>
                  {file.reviewStatus === 'rejected' && file.reviewNote && (
                    <span className="dim" style={{ fontSize: 13 }}>
                      退回原因：{file.reviewNote}
                    </span>
                  )}
                  {file.reviewStatus === 'approved' && file.reviewedAt && (
                    <span className="dim mono" style={{ fontSize: 12 }}>
                      放行于 {formatDateTime(file.reviewedAt)}
                    </span>
                  )}

                  {rejectingId === file.id && (
                    <div className="field" style={{ maxWidth: 420, marginTop: 4 }}>
                      <label htmlFor={`note-${file.id}`}>退回原因（可留空）</label>
                      <input
                        id={`note-${file.id}`}
                        autoFocus
                        value={note}
                        placeholder="例如：与本站收存范围不符"
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void decide(file, 'reject', note.trim());
                          if (e.key === 'Escape') {
                            setRejectingId(null);
                            setNote('');
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flex: '0 0 auto' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setPreviewId(previewId === file.id ? null : file.id)}
                  >
                    {previewId === file.id ? '收起' : '预览'}
                  </button>
                  {file.reviewStatus !== 'approved' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busyId === file.id}
                      onClick={() => void decide(file, 'approve')}
                    >
                      收录
                    </button>
                  )}
                  {rejectingId === file.id ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busyId === file.id}
                        onClick={() => void decide(file, 'reject', note.trim())}
                      >
                        确认退回
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          setRejectingId(null);
                          setNote('');
                        }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busyId === file.id}
                      onClick={() => {
                        setRejectingId(file.id);
                        setNote('');
                      }}
                    >
                      退回
                    </button>
                  )}
                </span>
              </div>

              {previewId === file.id && (
                <div style={{ marginTop: 'var(--sp-3)' }}>
                  <FilePreview file={file} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && items.length >= 100 && (
        <p className="dim" style={{ fontSize: 12, marginTop: 'var(--sp-2)' }}>
          只显示前 100 条；处理完这批后刷新即可看到剩下的。
        </p>
      )}
    </div>
  );
}

/** 能当纯文本读出来的扩展名；其余（PDF / 归档）不能按文本处理 */
const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'json', 'csv']);

/**
 * 待审文件预览：坞主要看得见才敢批。
 *
 * 做法是先用登录令牌换一条 120 秒的预览直链（票），再交给 <img>/<video>/<audio>
 * 自己加载 —— 它们带不上 Authorization 头，而公开的 /media 对未收录文件一律 403。
 * 底层 sendFile 支持 Range，所以视频能拖进度条。
 */
function FilePreview({ file }: { file: FileItem }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setText(null);
    setError(null);
    void (async () => {
      try {
        const ticket = await filesApi.previewTicket(file.id);
        if (!alive) return;
        setUrl(ticket.url);
        // 只有纯文本才取正文；PDF 交给 iframe，归档类只能给下载链接
        if (TEXT_EXT.has(file.ext)) {
          const res = await fetch(ticket.url);
          if (!res.ok) throw new Error(`取正文失败（HTTP ${res.status}）`);
          const body = await res.text();
          if (alive) {
            setText(
              body.length > 20000
                ? `${body.slice(0, 20000)}\n\n…（已截断，完整内容请看下面的原文件链接）`
                : body,
            );
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '预览失败');
      }
    })();
    return () => {
      alive = false;
    };
  }, [file.id, file.kind, file.ext]);

  if (error) return <div className="notice notice-error">{error}</div>;
  if (!url) return <p className="dim" style={{ fontSize: 13 }}>正在换预览票…</p>;

  const sunken = 'var(--bg-sunken, #101010)';

  return (
    <div className="stack" style={{ gap: 8 }}>
      {file.kind === 'image' && (
        <img
          src={url}
          alt={file.originalName}
          style={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain', background: sunken, borderRadius: 6 }}
        />
      )}
      {file.kind === 'video' && (
        <video src={url} controls preload="metadata" style={{ maxWidth: '100%', maxHeight: 520, background: sunken, borderRadius: 6 }} />
      )}
      {file.kind === 'audio' && <audio src={url} controls style={{ width: '100%' }} />}
      {file.ext === 'pdf' && (
        <iframe
          src={url}
          title={file.originalName}
          style={{ width: '100%', height: 560, border: 0, borderRadius: 6, background: sunken }}
        />
      )}
      {TEXT_EXT.has(file.ext) &&
        (text === null ? (
          <p className="dim" style={{ fontSize: 13 }}>正在读取正文…</p>
        ) : (
          <pre
            style={{
              maxHeight: 520,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 13,
              lineHeight: 1.7,
              padding: 'var(--sp-3)',
              background: sunken,
              borderRadius: 6,
            }}
          >
            {text || '（空文件）'}
          </pre>
        ))}
      {/* 归档（zip / 7z / rar …）：浏览器没法内嵌渲染，只能给下载链接 */}
      {!TEXT_EXT.has(file.ext) &&
        file.ext !== 'pdf' &&
        file.kind !== 'image' &&
        file.kind !== 'video' &&
        file.kind !== 'audio' && (
          <p className="dim" style={{ fontSize: 13 }}>
            此类文件无法内嵌预览，请用下面的原文件链接下载查看。
          </p>
        )}
      <a className="dim" style={{ fontSize: 12 }} href={url} target="_blank" rel="noreferrer">
        新窗口打开原文件 ›
      </a>
    </div>
  );
}
