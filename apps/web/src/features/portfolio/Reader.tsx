/**
 * 前端一 · 阅读页（/library/:slug）
 * 正文渲染 + 首行缩进开关 + 导出长图 + 分享（登录态）。
 */
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MdViewer } from '@/components/MdViewer';
import { ErrorBox, Loading } from '@/components/Bits';
import { ShareDialog } from '@/components/ShareDialog';
import { publicApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { exportNodeToPng } from '@/lib/export-image';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/Toast';

export function Reader() {
  const { slug = '' } = useParams();
  const { data, loading, error, reload } = useAsync(() => publicApi.document(slug), [slug]);
  const [indent, setIndent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);
  const { isOwner } = useAuth();
  const { push } = useToast();

  /** 文库阅读页一键导出：直接跟随当前浏览的风格，不弹窗 */
  const exportImage = async () => {
    if (!articleRef.current || !data) return;
    setExporting(true);
    try {
      const bytes = await exportNodeToPng({
        node: articleRef.current,
        fileName: data.title || data.slug,
        style: 'theme',
      });
      push(`长图已导出（${Math.round(bytes / 1024)} KB）· 与当前风格一致`, 'ok');
    } catch (e) {
      push(e instanceof Error ? `导出失败：${e.message}` : '导出失败', 'err');
    } finally {
      setExporting(false);
    }
  };

  const downloadMd = () => {
    if (!data) return;
    const blob = new Blob([data.contentMd], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.slug}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  if (loading) return <Loading />;
  if (error) return <div className="container page"><ErrorBox message={error} onRetry={reload} /></div>;
  if (!data) return null;

  return (
    <div className="container page reader-page">
      <div className="reader-toolbar">
        <Link to="/library" className="btn btn-sm btn-ghost">
          ‹ 回文库
        </Link>
        <div className="row" style={{ gap: 8 }}>
          <label className="check">
            <input type="checkbox" checked={indent} onChange={(e) => setIndent(e.target.checked)} />
            首行缩进
          </label>
          <button type="button" className="btn btn-sm" onClick={downloadMd}>
            下载 .md
          </button>
          {isOwner && (
            <button type="button" className="btn btn-sm" onClick={() => setShareOpen(true)}>
              分享
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" disabled={exporting} onClick={exportImage}>
            {exporting ? '导出中…' : '导出为图片'}
          </button>
        </div>
      </div>

      <article className="reader card" ref={articleRef}>
        <header className="reader-head">
          <h1 className="title-marked">{data.title}</h1>
          <div className="reader-meta dim mono">
            <span>{data.slug}</span>
            <span>更新于 {formatDateTime(data.updatedAt)}</span>
          </div>
        </header>
        <MdViewer markdown={data.contentMd} indent={indent} className="reader-body" />
        <footer className="reader-foot dim mono">藏经坞 · {data.slug}</footer>
      </article>

      {shareOpen && (
        <ShareDialog
          targetType="document"
          targetId={data.id}
          targetTitle={data.title}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
