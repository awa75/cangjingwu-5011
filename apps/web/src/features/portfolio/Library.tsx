/**
 * 前端一 · 文库
 *
 * 版式与作品集一致：文件夹是**横版长条**，文稿直接"圈"在长条里全部列出（不折叠、不点开）。
 * 每条右侧有一个小方块「下载所有文件」——只有绑定了文件的文稿才有，点了直接下 zip；
 * 没绑定文件的条目不长这个方块。
 *
 * 长条之后是「影像」区：已收录的图片 / 视频 / 音频直接摆出来（收录即发布）。
 * 影像不进文件夹，也不参与拖拽排序 —— 它们是文件的陈列，不是文稿。
 *
 * 管理员登录后：文稿可以拖着排序、拖进别的文件夹，**文件夹长条本身也能拖着换位置**；
 * 访客不可拖、也不显示任何管理控件。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Collection, DocumentItem, FileItem } from '@cangjingwu/shared';
import { EmptyState, ErrorBox, Loading, PageHeader } from '@/components/Bits';
import { collectionsApi, documentsApi, publicApi } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { useSite } from '@/hooks/useSite';
import { useToast } from '@/components/Toast';
import { moveFolder, reorderList, useDragSort } from '@/hooks/useDragSort';

export function Library() {
  const { site } = useSite();
  const { isOwner } = useAuth();
  const { push } = useToast();

  const folders = useAsync(() => publicApi.collections(), []);
  const docs = useAsync(() => publicApi.documents(), []);
  const media = useAsync(() => publicApi.media(), []);

  /** 本地副本：拖拽后先乐观更新，再提交 */
  const [items, setItems] = useState<DocumentItem[]>([]);
  useEffect(() => {
    if (docs.data) setItems(docs.data.items);
  }, [docs.data]);

  /** 文件夹顺序的本地副本（拖文件夹时先动它） */
  const [order, setOrder] = useState<Collection[]>([]);
  useEffect(() => {
    if (folders.data) setOrder(folders.data.items);
  }, [folders.data]);

  const onItemDrop = useCallback(
    async (
      drag: { id: string; folderId: string | null },
      target: { folderId: string | null; beforeId: string | null },
    ) => {
      const flat = items.map((i) => ({ id: i.id, folderId: i.collectionId }));
      const next = reorderList(flat, drag, target);
      if (next === flat) return;

      const byId = new Map(items.map((i) => [i.id, i]));
      setItems(next.map((n) => ({ ...(byId.get(n.id) as DocumentItem), collectionId: n.folderId })));

      try {
        await documentsApi.reorder(next.map((n) => ({ id: n.id, collectionId: n.folderId })));
        folders.reload();
        push(drag.folderId === target.folderId ? '顺序已保存' : '已移动到新文件夹', 'ok');
      } catch (e) {
        push(e instanceof Error ? e.message : '保存失败', 'err');
        docs.reload();
      }
    },
    [items, folders, docs, push],
  );

  /** 拖文件夹长条：改的是文件夹之间的先后 */
  const onFolderDrop = useCallback(
    async (dragId: string, overId: string | null, after: boolean) => {
      const next = moveFolder(order, dragId, overId, after);
      if (!next) return;

      setOrder(next);
      try {
        await collectionsApi.reorder(next.map((f) => ({ id: f.id })));
        push('文件夹顺序已保存', 'ok');
      } catch (e) {
        push(e instanceof Error ? e.message : '保存失败', 'err');
        folders.reload();
      }
    },
    [order, folders, push],
  );

  const { itemProps, folderProps, isDragging } = useDragSort(isOwner, {
    onItemDrop,
    onFolderDrop,
  });

  const loading = folders.loading || docs.loading;
  const error = folders.error || docs.error;
  const folderList: Collection[] = order;
  const mediaList: FileItem[] = media.data?.items ?? [];
  const unassigned = items.filter((it) => !it.collectionId);
  const hasFolders = folderList.length > 0;
  /** 文稿与影像都空，才算文库真的空 */
  const nothingYet = items.length === 0 && mediaList.length === 0;

  const reload = () => {
    folders.reload();
    docs.reload();
    media.reload();
  };

  /** 一条文稿：整行可点进阅读页，右侧小方块单独下载 */
  const renderDoc = (doc: DocumentItem, folderId: string | null) => (
    <li key={doc.id} className="doc-item card" {...(isOwner ? itemProps({ id: doc.id, folderId }) : {})}>
      <Link className="doc-item-main" to={`/library/${doc.slug}`}>
        <span className="doc-item-head">
          <h3>{doc.title}</h3>
          <span className="row" style={{ gap: 6 }}>
            {doc.pinned && <span className="seal seal-running">置顶</span>}
          </span>
        </span>
        {doc.excerpt && <span className="dim doc-excerpt">{doc.excerpt}</span>}
        <span className="doc-item-foot dim mono">
          {/* slug 与标题相同时不重复显示（中文标题的 slug 常常就是标题本身） */}
          <span>{doc.slug === doc.title ? '' : doc.slug}</span>
          <span>
            {formatDate(doc.updatedAt)} · {timeAgo(doc.updatedAt)}
          </span>
        </span>
      </Link>

      {/* 小方块：有绑定文件才出现 */}
      {doc.fileCount > 0 && (
        <a
          className="doc-dl"
          href={publicApi.documentZipUrl(doc.slug)}
          download
          title={`下载所有文件（${doc.fileCount} 个，打包成 zip）`}
          aria-label={`下载《${doc.title}》绑定的全部 ${doc.fileCount} 个文件`}
        >
          <span className="doc-dl-glyph" aria-hidden="true">
            ↓
          </span>
          <span className="doc-dl-count mono">{doc.fileCount}</span>
        </a>
      )}
    </li>
  );

  /** 一件影像：图片点开看原图；视频 / 音频内嵌播放（preload=none，不预下载） */
  const renderMedia = (m: FileItem) => (
    <li key={m.id} className="media-card card">
      {m.kind === 'image' && (
        <a
          className="media-frame"
          href={m.rawUrl}
          target="_blank"
          rel="noreferrer"
          title={`查看原图：${m.originalName}`}
        >
          <img
            src={m.hasThumb ? m.thumbUrl : m.rawUrl}
            alt={m.originalName}
            loading="lazy"
            decoding="async"
          />
        </a>
      )}

      {m.kind === 'video' && (
        <video
          className="media-frame"
          src={m.rawUrl}
          poster={m.hasThumb ? m.thumbUrl : undefined}
          controls
          preload="none"
          playsInline
        />
      )}

      {m.kind === 'audio' && (
        <div className="media-frame media-audio">
          <span className="media-audio-glyph" aria-hidden="true">
            声
          </span>
          <audio src={m.rawUrl} controls preload="none" />
        </div>
      )}

      <div className="media-meta">
        <span className="media-name" title={m.originalName}>
          {m.originalName}
        </span>
        <span className="dim mono media-sub">
          {m.width && m.height ? `${m.width}×${m.height}` : m.kind} · {formatDate(m.createdAt)}
        </span>
      </div>
    </li>
  );

  const renderBand = (folder: Collection) => {
    const list = items.filter((it) => it.collectionId === folder.id);
    return (
      <section
        key={folder.id}
        className={`doc-band${isDragging ? ' is-dragging' : ''}`}
        title={isOwner ? '拖动这条可以调整文件夹顺序' : undefined}
        {...folderProps(folder.id)}
      >
        <header className="folder-band-head">
          <span className="folder-tab" aria-hidden="true" />
          <h2 className="folder-band-title">{folder.title}</h2>
          <span className="tag">{list.length} 篇</span>
          {folder.summary && <span className="folder-band-summary dim">{folder.summary}</span>}
        </header>
        <ul className="doc-list">{list.map((d) => renderDoc(d, folder.id))}</ul>
        {list.length === 0 && <p className="dim doc-band-empty">这一卷还没有文稿。</p>}
      </section>
    );
  };

  return (
    <div className="container page">
      {/* 题记：从旧站首页搬来（那页已废弃），文案全部来自 useSite() */}
      <section className="hero">
        <p className="hero-tagline">{site.site_tagline}</p>
        <h1 className="hero-title">{site.site_name}</h1>
        <p className="hero-sub dim">{site.site_subtitle}</p>
        {site.hero_text && <p className="hero-text">{site.hero_text}</p>}
      </section>

      <PageHeader
        title="文库"
        code="卷二 ·"
        subtitle="Markdown 文稿，可在线阅读，也可导出为长图"
        extra={<span className="tag">{items.length ? `${items.length} 篇` : '—'}</span>}
      />

      {isOwner && hasFolders && (
        <p className="drag-hint">
          你是坞主：拖动文件夹长条可以调整顺序（落在长条上/下半区 = 插到它前/后）；拖动文稿可以排序，
          拖进别的文件夹就是移动（访客看不到这些操作）。
        </p>
      )}

      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {!loading && !error && nothingYet && (
        <EmptyState
          title="文库尚空"
          hint={isOwner ? '在「编辑 → 文稿」新建一篇，或去「审核」收录投稿，这里就会出现。' : '此处收存的文稿会陆续添入。'}
        />
      )}

      {!loading && !error && hasFolders && folderList.map(renderBand)}

      {!loading && !error && !hasFolders && items.length > 0 && (
        <ul className="doc-list">{items.map((d) => renderDoc(d, null))}</ul>
      )}

      {!loading && !error && hasFolders && unassigned.length > 0 && (
        <section className={`doc-band is-unfiled${isDragging ? ' is-dragging' : ''}`} {...folderProps(null)}>
          <header className="folder-band-head">
            <span className="folder-tab" aria-hidden="true" />
            <h2 className="folder-band-title">未归档</h2>
            <span className="tag">{unassigned.length} 篇</span>
            <span className="folder-band-summary dim">还没放进任何文件夹</span>
          </header>
          <ul className="doc-list">{unassigned.map((d) => renderDoc(d, null))}</ul>
        </section>
      )}

      {!loading && !error && mediaList.length > 0 && (
        <section className="doc-band is-media">
          <header className="folder-band-head">
            <span className="folder-tab" aria-hidden="true" />
            <h2 className="folder-band-title">影像</h2>
            <span className="tag">{mediaList.length} 件</span>
            <span className="folder-band-summary dim">已收录的图片、视频与声音</span>
          </header>
          <ul className="media-grid">{mediaList.map(renderMedia)}</ul>
        </section>
      )}
    </div>
  );
}
