/**
 * 前端一 · 投稿页（/upload，任何登录者都能进）
 *
 * 拖拽上传 + 我的投稿管理：改名、公开/私有、生成分享、删除；
 * 每一行显示收录状态（待审 / 已收录 / 已退回）—— 投稿后需经坞主收录才对外可见。
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { FileItem, FileKind, ReviewStatus } from '@cangjingwu/shared';
import { FILE_KINDS } from '@cangjingwu/shared';
import { filesApi } from '@/lib/api';
import { formatBytes, formatDateTime, kindLabel } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { ErrorBox, Loading, PageHeader } from '@/components/Bits';
import { FileThumb } from '@/components/FileThumb';
import { Uploader } from '@/components/Uploader';
import { ShareDialog } from '@/components/ShareDialog';
import { useToast } from '@/components/Toast';

/** 收录状态 → 文案与印章样式 */
const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: '待审',
  approved: '已收录',
  rejected: '已退回',
};
const REVIEW_SEAL: Record<ReviewStatus, string> = {
  pending: 'seal-queued',
  approved: 'seal-succeeded',
  rejected: 'seal-failed',
};

export function UploadPage() {
  const { user, ready } = useAuth();
  const location = useLocation();
  const { push } = useToast();

  const [kind, setKind] = useState<FileKind | ''>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [shareFile, setShareFile] = useState<FileItem | null>(null);

  const { data, loading, error, reload } = useAsync(
    () => (user ? filesApi.list({ kind, q: search, pageSize: 100 }) : Promise.resolve(null)),
    [user, kind, search],
  );

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  if (!ready) return <Loading text="验契中…" />;

  // 未登录：只给一句提示与登录入口（登录后回到本页）
  if (!user) {
    return (
      <div className="container page">
        <div className="notice">
          投稿需要先登录。
          <Link to={`/login?redirect=${encodeURIComponent(location.pathname)}`}>先登录 ›</Link>
          <span className="dim">（还没有契？<Link to="/register">用注册码注册 ›</Link>）</span>
        </div>
      </div>
    );
  }

  const rename = async (file: FileItem) => {
    const name = draftName.trim();
    setEditingId(null);
    if (!name || name === file.originalName) return;
    try {
      await filesApi.patch(file.id, { originalName: name });
      push('已重命名', 'ok');
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '重命名失败', 'err');
    }
  };

  const toggleVisibility = async (file: FileItem) => {
    try {
      await filesApi.patch(file.id, { visibility: file.visibility === 'public' ? 'private' : 'public' });
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '修改可见性失败', 'err');
    }
  };

  const remove = async (file: FileItem) => {
    if (!window.confirm(`删除「${file.originalName}」？（软删除，磁盘文件保留）`)) return;
    try {
      await filesApi.remove(file.id, false);
      push('已删除', 'ok');
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '删除失败', 'err');
    }
  };

  return (
    <div className="container page">
      <PageHeader title="上传" code="卷三 ·" subtitle="投递影像、音声与文稿；投稿后需经坞主收录才对外可见" />

      <Uploader onUploaded={() => reload()} />

      <section className="files-section">
        <div className="files-toolbar row">
          <div className="field" style={{ maxWidth: 160 }}>
            <select value={kind} onChange={(e) => setKind(e.target.value as FileKind | '')}>
              <option value="">全部类型</option>
              {FILE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 200px', maxWidth: 320 }}>
            <input
              type="search"
              placeholder="按文件名搜索"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="tag">{data ? `${data.total} 个文件` : '—'}</span>
        </div>

        {loading && <Loading text="翻检中…" />}
        {error && <ErrorBox message={error} onRetry={reload} />}

        {data && data.items.length === 0 && <div className="notice">还没有文件，先在上面投递吧。</div>}

        {data && data.items.length > 0 && (
          <div className="table-wrap card">
            <table className="file-table">
              <thead>
                <tr>
                  <th>预览</th>
                  <th>文件名</th>
                  <th>类型</th>
                  <th>大小</th>
                  <th>收录状态</th>
                  <th>可见性</th>
                  <th>上传时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <FileThumb file={file} />
                    </td>
                    <td className="cell-name">
                      {editingId === file.id ? (
                        <span className="row" style={{ gap: 4 }}>
                          <input
                            value={draftName}
                            autoFocus
                            onChange={(e) => setDraftName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void rename(file);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <button type="button" className="btn btn-sm" onClick={() => void rename(file)}>
                            存
                          </button>
                        </span>
                      ) : (
                        <span className="mono">{file.originalName}</span>
                      )}
                    </td>
                    <td>{kindLabel(file.kind)}</td>
                    <td className="mono">{formatBytes(file.size)}</td>
                    <td>
                      <span
                        className={`seal ${REVIEW_SEAL[file.reviewStatus] ?? 'seal-queued'}`}
                        title={file.reviewStatus === 'rejected' && file.reviewNote ? file.reviewNote : undefined}
                      >
                        {REVIEW_LABEL[file.reviewStatus] ?? file.reviewStatus}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void toggleVisibility(file)}>
                        {file.visibility === 'public' ? '公开' : '私有'}
                      </button>
                    </td>
                    <td className="mono dim">{formatDateTime(file.createdAt)}</td>
                    <td>
                      <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            setEditingId(file.id);
                            setDraftName(file.originalName);
                          }}
                        >
                          改名
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setShareFile(file)}>
                          分享
                        </button>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(file)}>
                          删除
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {shareFile && (
        <ShareDialog
          targetType="file"
          targetId={shareFile.id}
          targetTitle={shareFile.originalName}
          onClose={() => setShareFile(null)}
        />
      )}
    </div>
  );
}
