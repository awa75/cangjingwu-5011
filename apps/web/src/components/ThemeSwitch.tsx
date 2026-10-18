/**
 * 主题切换
 *   按钮：在**全部**主题之间挨个循环（本站主题 + 风格库，共 ALL_THEMES.length 个）
 *   面板：本站主题 + 风格库全部风格（可搜索，带色板预览）
 *
 * 风格库来自 https://github.com/rxw2023/Front-end-Design-Styles，
 * 由 scripts/fetch-design-styles.mjs 抓取并映射成本站 token。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_THEMES,
  CORE_THEMES,
  GALLERY_THEMES,
  useTheme,
  type ThemeMeta,
} from '@/hooks/useTheme';

function Swatches({ theme }: { theme: ThemeMeta }) {
  const colors = theme.swatches?.length ? theme.swatches.slice(0, 4).map((s) => s.hex) : [];
  if (colors.length === 0) {
    return <span className="theme-swatch theme-swatch-glyph">{theme.glyph ?? '字'}</span>;
  }
  return (
    <span className="theme-swatch" aria-hidden="true">
      {colors.map((c, i) => (
        <i key={`${c}-${i}`} style={{ background: c }} />
      ))}
    </span>
  );
}

/** 一行主题 */
function ThemeRow({
  item,
  active,
  onPick,
}: {
  item: ThemeMeta;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`theme-item${active ? ' is-active' : ''}`}
      onClick={onPick}
      title={item.hint || item.en}
    >
      <Swatches theme={item} />
      <span className="theme-item-text">
        <strong>
          {item.name}
          {item.dark && <em className="theme-dark-dot" title="深色主题">暗</em>}
        </strong>
        <em className="dim">{item.en ?? item.hint}</em>
      </span>
      {active && <span className="theme-check" aria-hidden="true">✓</span>}
    </button>
  );
}

export function ThemeSwitch() {
  const { theme, meta, setTheme, cycle } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const keyword = q.trim().toLowerCase();
  const gallery = useMemo(() => {
    if (!keyword) return GALLERY_THEMES;
    return GALLERY_THEMES.filter((t) =>
      `${t.name} ${t.en ?? ''} ${t.id}`.toLowerCase().includes(keyword),
    );
  }, [keyword]);

  const pick = (id: string) => {
    setTheme(id);
    if (!keyword) setOpen(false);
  };

  return (
    <div className="theme-switch" ref={boxRef}>
      <button
        type="button"
        className="btn btn-sm theme-btn"
        onClick={cycle}
        title={`当前：${meta.name} —— 点一下换下一个，在全部 ${ALL_THEMES.length} 个风格里挨个循环（Ctrl/⌘ + Alt + T）`}
        aria-label={`切换主题，当前 ${meta.name}`}
      >
        <span className="theme-glyph" aria-hidden="true">
          {meta.glyph ?? '风'}
        </span>
        <span className="theme-name">{meta.name}</span>
      </button>
      <button
        type="button"
        className="btn btn-sm theme-caret"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="展开主题列表"
        onClick={() => setOpen((v) => !v)}
      >
        ▾
      </button>

      {open && (
        <div className="theme-menu" role="dialog" aria-label="选择主题">
          <input
            className="theme-search"
            type="search"
            placeholder={`在 ${GALLERY_THEMES.length} 个风格里搜（中文 / 英文）`}
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && gallery[0]) pick(gallery[0].id);
            }}
          />

          <div className="theme-menu-scroll" role="listbox">
            <p className="theme-group-title">本站主题</p>
            {CORE_THEMES.map((t) => (
              <ThemeRow key={t.id} item={t} active={t.id === theme} onPick={() => pick(t.id)} />
            ))}

            <p className="theme-group-title">
              风格库
              <span className="dim"> · {keyword ? `${gallery.length} / ${GALLERY_THEMES.length}` : GALLERY_THEMES.length} 个</span>
            </p>
            {gallery.map((t) => (
              <ThemeRow key={t.id} item={t} active={t.id === theme} onPick={() => pick(t.id)} />
            ))}
            {gallery.length === 0 && <p className="dim theme-empty">没有匹配的风格。</p>}
          </div>

          <p className="theme-menu-foot dim">
            风格库来自 GitHub <span className="mono">rxw2023/Front-end-Design-Styles</span>
          </p>
        </div>
      )}
    </div>
  );
}
