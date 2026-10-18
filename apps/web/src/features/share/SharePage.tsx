/**
 * 免登录分享页（/s/:token）
 * - 文稿：直接渲染 Markdown（元数据里带正文），另给一份 .md 原文下载
 * - 文件：图片 / 视频 / 音频就地查看；一律走 /api/s/:token/raw，
 *   因为分享的文件可能是 private，/media/* 对未登录访客是 403。
 */
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MdViewer } from '@/components/MdViewer';
import { ErrorBox, Loading } from '@/components/Bits';
import { sharesApi } from '@/lib/api';
import { formatBytes, formatDateTime, kindLabel } from '@/lib/format';
import { exportNodeToPng } from '@/lib/export-image';
import { useAsync } from '@/hooks/useAsync';
import { useToast } from '@/components/Toast';

export function SharePage() {
  const { token = '' } = useParams();
  const { data, loading, error, reload } = useAsync(() => sharesApi.resolve(token), [token]);
  const [exporting, setExporting] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);
  const { push } = useToast();
  const rawUrl = sharesApi.rawUrl(token);

  const exportImage = async () => {
    if (!nodeRef.current) return;
    setExporting(true);
    try {
      await exportNodeToPng({ node: nodeRef.current, fileName: data?.title || '分享文稿', style: 'theme', forceTheme: 'paper' });
      push('长图已导出', 'ok');
    } catch (e) {
      push(e instanceof Error ? `导出失败：${e.message}` : '导出失败', 'err');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <Loading />;

  if (error) {
    const gone = error.includes('失效') || error.includes('过期') || error.includes('撤回');
    return (
      <div className="container page slim">
        <div className="notice notice-error">
          <h3>{gone ? '此契已失效' : '无法打开分享'}</h3>
          <p>{error}</p>
          <Link to="/">回到藏经坞首页 ›</Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const doc = data.document;
  const file = data.file;

  return (
    <div className="container page slim share-page">
      <header className="share-head">
        <p className="mono dim">免登录分享 · {data.expiresAt ? `至 ${formatDateTime(data.expiresAt)}` : '长期有效'}</p>
        <h1 className="title-marked">{data.title}</h1>
        <div className="row">
          <span className="tag">{data.targetType === 'document' ? '文稿' : '文件'}</span>
          {data.remainingViews !== null && <span className="tag">剩余可访问 {data.remainingViews} 次</span>}
        </div>
      </header>

      {doc && (
        <>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <a className="btn btn-sm" href={rawUrl} download={`${doc.slug}.md`}>
              下载 .md
            </a>
            <button type="button" className="btn btn-sm btn-primary" disabled={exporting} onClick={exportImage}>
              {exporting ? '导出中…' : '导出为图片'}
            </button>
          </div>
          <article className="reader card" ref={nodeRef}>
            <MdViewer markdown={doc.contentMd} className="reader-body" />
            <footer className="reader-foot dim mono">藏经坞 · {doc.slug}</footer>
          </article>
        </>
      )}

      {file && (
        <article className="card panel share-file">
          {file.kind === 'image' && <img src={rawUrl} alt={file.originalName} />}
          {file.kind === 'video' && <video src={rawUrl} controls playsInline />}
          {file.kind === 'audio' && <audio src={rawUrl} controls />}
          <div className="share-file-meta">
            <span className="mono dim">
              {kindLabel(file.kind)} · {formatBytes(file.size)} · {formatDateTime(file.createdAt)}
            </span>
            <a className="btn btn-sm" href={rawUrl} download={file.originalName}>
              下载原文件
            </a>
          </div>
        </article>
      )}

      <p className="dim center share-foot">
        本页由《藏经坞》生成 · <Link to="/">进入藏经坞</Link>
      </p>
    </div>
  );
}
