/**
 * 坞主编辑台（/edit）—— 替代旧站那 21 页管理后台
 *
 * 五块（标签页）：
 *   文稿    新建 / 编辑（标题、slug、正文 Markdown、置顶、可见、所属文件夹）/ 删除 / 绑定文件
 *   文件夹  新建 / 编辑（slug、标题、摘要、卷首说明）/ 删除
 *   邀请码  生成 / 停用 / 删除
 *   问卷    新建 / 编辑题目 / 复制外发链接 / 看答卷 / 导出 CSV
 *   站点文案 站名、副标题、题记、首页说明、页脚、协议编号、联系方式
 *
 * 界面一律复用现有类名（container page / card / panel / notice / field / btn / seal …），
 * 没有新增任何 CSS。
 */
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type {
  Collection,
  DocumentFileItem,
  DocumentItem,
  FileItem,
  InviteCode,
  SiteSettings,
} from '@cangjingwu/shared';
import { collectionsApi, documentsApi, filesApi, ownerApi } from '@/lib/api';
import { formatBytes, formatDateTime, kindLabel } from '@/lib/format';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState, ErrorBox, Loading, PageHeader } from '@/components/Bits';
import { LevelSelect } from '@/components/LevelSelect';
import { useToast } from '@/components/Toast';
import { SurveysPanel } from './SurveysPanel';

type Tab = 'docs' | 'folders' | 'codes' | 'site' | 'surveys';

const TABS: { value: Tab; label: string }[] = [
  { value: 'docs', label: '文稿' },
  { value: 'folders', label: '文件夹' },
  { value: 'codes', label: '邀请码' },
  { value: 'surveys', label: '问卷' },
  { value: 'site', label: '站点文案' },
];

export function EditPage() {
  const { user, isOwner, ready } = useAuth();
  const location = useLocation();

  const [tab, setTab] = useState<Tab>('docs');

  // 概览数字（坞主一眼看清家底）：两个接口一起拉
  const overview = useAsync(
    () =>
      isOwner
        ? Promise.all([ownerApi.stats(), ownerApi.settings()]).then(([stats, settings]) => ({
            stats,
            settings,
          }))
        : Promise.resolve(null),
    [isOwner],
  );

  if (!ready) return <Loading text="验契中…" />;

  if (!user || !isOwner) {
    return (
      <div className="container page">
        <div className="notice">
          编辑台是坞主的工具。
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

  const stats = overview.data?.stats ?? null;

  return (
    <div className="container page">
      <PageHeader
        title="编辑台"
        code="卷五 ·"
        subtitle="文稿、文件夹、邀请码、问卷与站点文案，都在这五处维护"
      />

      {/* 概览数字 */}
      <div className="row" style={{ marginBottom: 'var(--sp-5)' }}>
        {stats ? (
          <>
            <span className="tag">文件 {stats.files.total}</span>
            <span className="tag">待审 {stats.files.pending}</span>
            <span className="tag">占用 {formatBytes(stats.files.totalBytes)}</span>
            <span className="tag">文稿 {stats.documents.total}</span>
            <span className="tag">文件夹 {stats.collections.total}</span>
            <span className="tag">
              分享 {stats.shares.active} / {stats.shares.total}
            </span>
            <span className="tag">磁盘余 {formatBytes(stats.storage.diskFreeBytes)}</span>
            <span className="tag">ffmpeg {stats.system.ffmpegAvailable ? '可用' : '不可用'}</span>
          </>
        ) : (
          <span className="tag">{overview.loading ? '正在点数…' : '概览不可用'}</span>
        )}
      </div>

      <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`btn btn-sm${tab === t.value ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'docs' && <DocsPanel />}
      {tab === 'folders' && <FoldersPanel />}
      {tab === 'codes' && <CodesPanel />}
      {tab === 'surveys' && <SurveysPanel />}
      {tab === 'site' && <SitePanel initial={overview.data?.settings ?? null} />}
    </div>
  );
}

/* ==================================================================== 通用小块 */

/** 折叠面板：一个标题 + 展开后的内容（不引 CSS，用现有 class 拼） */
function Drawer({
  title,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <span className="row" style={{ gap: 8, minWidth: 0 }}>
          {title}
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      </div>
      {open && <div style={{ marginTop: 'var(--sp-4)' }}>{children}</div>}
    </div>
  );
}

/* ==================================================================== 文稿 */

interface DocDraft {
  id: string | null;
  title: string;
  slug: string;
  contentMd: string;
  pinned: boolean;
  visible: boolean;
  minLevel: number;
  collectionId: string;
}

const EMPTY_DOC: DocDraft = {
  id: null,
  title: '',
  slug: '',
  contentMd: '',
  pinned: false,
  visible: true,
  minLevel: 1,
  collectionId: '',
};

function DocsPanel() {
  const { push } = useToast();
  const docs = useAsync(() => documentsApi.list(), []);
  const folders = useAsync(() => collectionsApi.list(), []);

  const [draft, setDraft] = useState<DocDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    docs.reload();
    folders.reload();
  };

  const folderTitle = (id: string | null) => {
    if (!id) return '未归档';
    return folders.data?.items.find((f) => f.id === id)?.title ?? '（已删除的文件夹）';
  };

  /** 打开编辑器：新建给空稿，编辑要先把正文拉回来（列表接口不返回正文） */
  const openNew = () => setDraft({ ...EMPTY_DOC });

  const openEdit = async (doc: DocumentItem) => {
    setBusy(true);
    try {
      const full = await documentsApi.get(doc.id);
      setDraft({
        id: full.id,
        title: full.title,
        slug: full.slug,
        contentMd: full.contentMd ?? '',
        pinned: full.pinned,
        visible: full.visible,
        minLevel: full.minLevel,
        collectionId: full.collectionId ?? '',
      });
    } catch (e) {
      push(e instanceof Error ? e.message : '读取文稿失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      push('标题不能为空', 'err');
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: draft.title.trim(),
        slug: draft.slug.trim() || undefined,
        contentMd: draft.contentMd,
        pinned: draft.pinned,
        visible: draft.visible,
        minLevel: draft.minLevel,
        collectionId: draft.collectionId || null,
      };
      if (draft.id) await documentsApi.update(draft.id, body);
      else await documentsApi.create({ ...body, title: draft.title.trim() });
      push(draft.id ? '已保存' : '已新建文稿', 'ok');
      setDraft(null);
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '保存失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: DocumentItem) => {
    if (!window.confirm(`删除文稿「${doc.title}」？`)) return;
    try {
      await documentsApi.remove(doc.id);
      push('已删除', 'ok');
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '删除失败', 'err');
    }
  };

  const togglePin = async (doc: DocumentItem) => {
    try {
      await documentsApi.setPin(doc.id, !doc.pinned);
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '操作失败', 'err');
    }
  };

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <span className="tag">{docs.data ? `${docs.data.total} 篇` : '—'}</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={openNew}>
          新建文稿
        </button>
      </div>

      {draft && (
        <div className="card panel" style={{ marginBottom: 'var(--sp-4)' }}>
          <h3 className="title-marked" style={{ marginBottom: 'var(--sp-4)' }}>
            {draft.id ? '编辑文稿' : '新建文稿'}
          </h3>

          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 240px' }}>
              <label htmlFor="doc-title">标题</label>
              <input
                id="doc-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="doc-slug">slug（留空自动生成）</label>
              <input
                id="doc-slug"
                className="mono"
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: '0 1 200px' }}>
              <label htmlFor="doc-folder">所属文件夹</label>
              <select
                id="doc-folder"
                value={draft.collectionId}
                onChange={(e) => setDraft({ ...draft, collectionId: e.target.value })}
              >
                <option value="">（未归档）</option>
                {folders.data?.items.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
            <label htmlFor="doc-body">正文（Markdown）</label>
            <textarea
              id="doc-body"
              className="mono"
              rows={18}
              value={draft.contentMd}
              onChange={(e) => setDraft({ ...draft, contentMd: e.target.value })}
            />
          </div>

          <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
              />
              置顶
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.visible}
                onChange={(e) => setDraft({ ...draft, visible: e.target.checked })}
              />
              可见
            </label>
            <LevelSelect value={draft.minLevel} onChange={(l) => setDraft({ ...draft, minLevel: l })} label="最低等级" />
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-4)' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      {docs.loading && <Loading text="翻检中…" />}
      {docs.error && <ErrorBox message={docs.error} onRetry={reload} />}
      {!docs.loading && !docs.error && (docs.data?.items.length ?? 0) === 0 && (
        <EmptyState title="还没有文稿" hint="点右上「新建文稿」写第一篇。" />
      )}

      {docs.data && docs.data.items.length > 0 && (
        <ul className="doc-list">
          {docs.data.items.map((doc) => (
            <li key={doc.id} className="card" style={{ padding: 'var(--sp-4)' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span className="stack" style={{ gap: 6, minWidth: 0 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <strong>{doc.title}</strong>
                    {doc.pinned && <span className="seal seal-running">置顶</span>}
                    {!doc.visible && <span className="seal seal-canceled">隐藏</span>}
                    <span className="tag">{folderTitle(doc.collectionId)}</span>
                    {doc.fileCount > 0 && <span className="tag">附件 {doc.fileCount}</span>}
                  </span>
                  <span className="dim mono" style={{ fontSize: 12 }}>
                    {doc.slug} · 更新于 {formatDateTime(doc.updatedAt)}
                  </span>
                </span>

                <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flex: '0 0 auto' }}>
                  <button type="button" className="btn btn-sm" onClick={() => void openEdit(doc)}>
                    编辑
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void togglePin(doc)}>
                    {doc.pinned ? '取消置顶' : '置顶'}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(doc)}>
                    删除
                  </button>
                </span>
              </div>

              <div style={{ marginTop: 'var(--sp-3)' }}>
                <BindFiles doc={doc} onChanged={reload} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 绑定 / 解绑文件（文库「下载所有文件」的来源） */
function BindFiles({ doc, onChanged }: { doc: DocumentItem; onChanged: () => void }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [pickId, setPickId] = useState('');
  const [busy, setBusy] = useState(false);

  const bound = useAsync(
    () => (open ? documentsApi.listFiles(doc.id) : Promise.resolve(null)),
    [open, doc.id],
  );
  // 候选文件：已收录的优先挑得出来，这里拉最近的一百条就够用
  const candidates = useAsync(() => (open ? filesApi.list({ pageSize: 100 }) : Promise.resolve(null)), [open]);

  const reload = () => {
    bound.reload();
    candidates.reload();
  };

  const bind = async () => {
    if (!pickId) return;
    setBusy(true);
    try {
      await documentsApi.bindFile(doc.id, pickId);
      push('已绑定', 'ok');
      setPickId('');
      reload();
      onChanged();
    } catch (e) {
      push(e instanceof Error ? e.message : '绑定失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const unbind = async (fileId: string) => {
    setBusy(true);
    try {
      await documentsApi.unbindFile(doc.id, fileId);
      push('已解绑', 'ok');
      reload();
      onChanged();
    } catch (e) {
      push(e instanceof Error ? e.message : '解绑失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const boundIds = new Set((bound.data?.items ?? []).map((it: DocumentFileItem) => it.fileId));
  const options: FileItem[] = (candidates.data?.items ?? []).filter((f: FileItem) => !boundIds.has(f.id));

  return (
    <Drawer title={<span className="dim">绑定文件（{doc.fileCount}）</span>}>
      {bound.loading && <Loading text="读数中…" />}
      {bound.error && <ErrorBox message={bound.error} onRetry={reload} />}

      {bound.data && bound.data.items.length === 0 && (
        <p className="dim" style={{ margin: '0 0 var(--sp-3)' }}>
          还没有绑定文件。
        </p>
      )}

      {bound.data && bound.data.items.length > 0 && (
        <ul className="doc-list" style={{ marginBottom: 'var(--sp-3)' }}>
          {bound.data.items.map((it) => (
            <li key={it.id} className="card" style={{ padding: '8px 12px' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span className="mono dim" style={{ wordBreak: 'break-all' }}>
                  {it.file ? `${it.file.originalName}（${kindLabel(it.file.kind)} · ${formatBytes(it.file.size)}）` : '（文件已删除）'}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={busy}
                  onClick={() => void unbind(it.fileId)}
                >
                  解绑
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 260px' }}>
          <label htmlFor={`bind-${doc.id}`}>绑定一个文件</label>
          <select id={`bind-${doc.id}`} value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="">（选一个文件）</option>
            {options.map((f) => (
              <option key={f.id} value={f.id}>
                {f.originalName}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-sm" disabled={!pickId || busy} onClick={() => void bind()}>
          绑定
        </button>
      </div>
    </Drawer>
  );
}

/* ==================================================================== 文件夹 */

interface FolderDraft {
  id: string | null;
  title: string;
  slug: string;
  summary: string;
  descriptionMd: string;
  visible: boolean;
  minLevel: number;
}

const EMPTY_FOLDER: FolderDraft = {
  id: null,
  title: '',
  slug: '',
  summary: '',
  descriptionMd: '',
  visible: true,
  minLevel: 1,
};

function FoldersPanel() {
  const { push } = useToast();
  const folders = useAsync(() => collectionsApi.list(), []);
  const [draft, setDraft] = useState<FolderDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      push('标题不能为空', 'err');
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: draft.title.trim(),
        slug: draft.slug.trim() || undefined,
        summary: draft.summary,
        descriptionMd: draft.descriptionMd,
        visible: draft.visible,
        minLevel: draft.minLevel,
      };
      if (draft.id) await collectionsApi.update(draft.id, body);
      else await collectionsApi.create({ ...body, title: draft.title.trim() });
      push(draft.id ? '已保存' : '已新建文件夹', 'ok');
      setDraft(null);
      folders.reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '保存失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (folder: Collection) => {
    if (!window.confirm(`删除文件夹「${folder.title}」？夹内文稿会回到「未归档」，文件不动。`)) return;
    try {
      await collectionsApi.remove(folder.id);
      push('已删除', 'ok');
      folders.reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '删除失败', 'err');
    }
  };

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <span className="tag">{folders.data ? `${folders.data.total} 个` : '—'}</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setDraft({ ...EMPTY_FOLDER })}>
          新建文件夹
        </button>
      </div>

      {draft && (
        <div className="card panel" style={{ marginBottom: 'var(--sp-4)' }}>
          <h3 className="title-marked" style={{ marginBottom: 'var(--sp-4)' }}>
            {draft.id ? '编辑文件夹' : '新建文件夹'}
          </h3>

          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 240px' }}>
              <label htmlFor="col-title">标题</label>
              <input
                id="col-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="col-slug">slug（留空自动生成）</label>
              <input
                id="col-slug"
                className="mono"
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
            </div>
          </div>

          <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
            <label htmlFor="col-summary">摘要（列表里的一句话）</label>
            <input
              id="col-summary"
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </div>

          <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
            <label htmlFor="col-desc">卷首说明（Markdown）</label>
            <textarea
              id="col-desc"
              className="mono"
              rows={8}
              value={draft.descriptionMd}
              onChange={(e) => setDraft({ ...draft, descriptionMd: e.target.value })}
            />
          </div>

          <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.visible}
                onChange={(e) => setDraft({ ...draft, visible: e.target.checked })}
              />
              可见
            </label>
            <LevelSelect value={draft.minLevel} onChange={(l) => setDraft({ ...draft, minLevel: l })} label="最低等级" />
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-4)' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      {folders.loading && <Loading text="翻检中…" />}
      {folders.error && <ErrorBox message={folders.error} onRetry={folders.reload} />}
      {!folders.loading && !folders.error && (folders.data?.items.length ?? 0) === 0 && (
        <EmptyState title="还没有文件夹" hint="建一个，文稿就能分卷归档。" />
      )}

      {folders.data && folders.data.items.length > 0 && (
        <ul className="doc-list">
          {folders.data.items.map((folder) => (
            <li key={folder.id} className="card" style={{ padding: 'var(--sp-4)' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span className="stack" style={{ gap: 6, minWidth: 0 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <strong>{folder.title}</strong>
                    {!folder.visible && <span className="seal seal-canceled">隐藏</span>}
                    <span className="tag">{folder.itemCount} 篇</span>
                  </span>
                  <span className="dim" style={{ fontSize: 13 }}>
                    {folder.summary || '（无摘要）'}
                  </span>
                  <span className="dim mono" style={{ fontSize: 12 }}>
                    {folder.slug} · LV{folder.minLevel} 及以上 · 更新于 {formatDateTime(folder.updatedAt)}
                  </span>
                </span>

                <span className="row" style={{ gap: 6, flexWrap: 'nowrap', flex: '0 0 auto' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setDraft({
                        id: folder.id,
                        title: folder.title,
                        slug: folder.slug,
                        summary: folder.summary,
                        descriptionMd: folder.descriptionMd ?? '',
                        visible: folder.visible,
                        minLevel: folder.minLevel,
                      })
                    }
                  >
                    编辑
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(folder)}>
                    删除
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ==================================================================== 邀请码 */

function CodesPanel() {
  const { push } = useToast();
  const codes = useAsync(() => ownerApi.codes(), []);

  const [count, setCount] = useState('1');
  const [level, setLevel] = useState(1);
  const [maxUses, setMaxUses] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await ownerApi.createCodes({
        count: Math.max(1, Number(count) || 1),
        level,
        maxUses: Math.max(1, Number(maxUses) || 1),
        note,
      });
      push(`已生成 ${res.items.length} 个邀请码`, 'ok');
      codes.reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '生成失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (code: InviteCode) => {
    try {
      await ownerApi.updateCode(code.code, { disabled: true });
      push('已停用', 'ok');
      codes.reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '停用失败', 'err');
    }
  };

  const remove = async (code: InviteCode) => {
    if (!window.confirm(`删除邀请码 ${code.code}？`)) return;
    try {
      await ownerApi.removeCode(code.code);
      push('已删除', 'ok');
      codes.reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '删除失败', 'err');
    }
  };

  const disableAll = async () => {
    if (!window.confirm('停用所有未用尽的邀请码？')) return;
    try {
      const res = await ownerApi.disableAllCodes();
      push(`已停用 ${res.disabled} 个`, 'ok');
      codes.reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '操作失败', 'err');
    }
  };

  return (
    <section>
      <div className="card panel" style={{ marginBottom: 'var(--sp-4)' }}>
        <h3 className="title-marked" style={{ marginBottom: 'var(--sp-4)' }}>
          生成邀请码
        </h3>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ maxWidth: 120 }}>
            <label htmlFor="code-count">数量</label>
            <input
              id="code-count"
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          <LevelSelect value={level} onChange={setLevel} label="注册后等级" />
          <div className="field" style={{ maxWidth: 140 }}>
            <label htmlFor="code-uses">可用次数</label>
            <input
              id="code-uses"
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="code-note">备注</label>
            <input id="code-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
            {busy ? '生成中…' : '生成'}
          </button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <span className="tag">{codes.data ? `${codes.data.items.length} 个` : '—'}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void disableAll()}>
          停用全部未用尽
        </button>
      </div>

      {codes.loading && <Loading text="翻检中…" />}
      {codes.error && <ErrorBox message={codes.error} onRetry={codes.reload} />}
      {!codes.loading && !codes.error && (codes.data?.items.length ?? 0) === 0 && (
        <EmptyState title="还没有邀请码" hint="上面生成一批，发给要进坞的人。" />
      )}

      {codes.data && codes.data.items.length > 0 && (
        <div className="table-wrap card">
          <table className="file-table">
            <thead>
              <tr>
                <th>邀请码</th>
                <th>等级</th>
                <th>已用 / 总</th>
                <th>状态</th>
                <th>备注</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {codes.data.items.map((code) => (
                <tr key={code.code}>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>
                    {code.code}
                  </td>
                  <td>LV{code.level}</td>
                  <td className="mono">
                    {code.usedCount} / {code.maxUses}
                  </td>
                  <td>
                    {code.disabled ? (
                      <span className="seal seal-canceled">已停用</span>
                    ) : code.usedCount >= code.maxUses ? (
                      <span className="seal seal-succeeded">已用尽</span>
                    ) : (
                      <span className="seal seal-running">可用</span>
                    )}
                  </td>
                  <td className="dim">{code.note || '—'}</td>
                  <td className="mono dim">{formatDateTime(code.createdAt)}</td>
                  <td>
                    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={code.disabled}
                        onClick={() => void disable(code)}
                      >
                        停用
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(code)}>
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
  );
}

/* ==================================================================== 站点文案 */

const SITE_FIELDS: { key: keyof SiteSettings; label: string; hint?: string; long?: boolean }[] = [
  { key: 'site_name', label: '站名' },
  { key: 'site_subtitle', label: '副标题（顶栏站名下面那行）' },
  { key: 'site_tagline', label: '题记（文库顶部那行小字）' },
  { key: 'hero_text', label: '首页说明（文库顶部那段）', long: true },
  { key: 'footer_text', label: '页脚文案' },
  { key: 'project_code', label: '协议编号' },
  { key: 'contact', label: '联系方式' },
];

function SitePanel({ initial }: { initial: SiteSettings | null }) {
  const { push } = useToast();
  // 概览里已经拉过一次；这里独立拉，保证单独打开这块也能用
  const site = useAsync(() => ownerApi.settings(), []);

  const current = site.data ?? initial;
  const [draft, setDraft] = useState<Partial<SiteSettings> | null>(null);
  const [busy, setBusy] = useState(false);

  if (site.loading && !current) return <Loading text="读取站点文案…" />;
  if (site.error && !current) return <ErrorBox message={site.error} onRetry={site.reload} />;
  if (!current) return null;

  const valueOf = (key: keyof SiteSettings) => draft?.[key] ?? current[key] ?? '';

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await ownerApi.saveSettings(draft);
      push('站点文案已保存（刷新后全站生效）', 'ok');
      setDraft(null);
      site.reload();
    } catch (e) {
      push(e instanceof Error ? e.message : '保存失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card panel">
      {SITE_FIELDS.map((f) => (
        <div key={f.key} className="field" style={{ marginBottom: 'var(--sp-3)' }}>
          <label htmlFor={`site-${f.key}`}>{f.label}</label>
          {f.long ? (
            <textarea
              id={`site-${f.key}`}
              rows={3}
              value={valueOf(f.key)}
              onChange={(e) => setDraft({ ...(draft ?? {}), [f.key]: e.target.value })}
            />
          ) : (
            <input
              id={`site-${f.key}`}
              value={valueOf(f.key)}
              onChange={(e) => setDraft({ ...(draft ?? {}), [f.key]: e.target.value })}
            />
          )}
        </div>
      ))}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" disabled={!draft} onClick={() => setDraft(null)}>
          撤销改动
        </button>
        <button type="button" className="btn btn-primary" disabled={!draft || busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </section>
  );
}
