/**
 * 主题状态
 *
 * 两来源合一：
 *   ① 本站主题：宣纸 / 墨夜（docs/02-视觉与主题.md 定的）
 *   ② 风格库：由 scripts/fetch-design-styles.mjs 从
 *      https://github.com/rxw2023/Front-end-Design-Styles 抓取并映射成同一套语义 token
 *
 * 所有主题都只改 <html> 上的 data-theme（外加一个 data-dark 供组件判断明暗），
 * 不重排 DOM、不动图片，切换是零成本的。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import manifest from '@/design/styles-manifest.json';

const STORAGE_KEY = 'cjw:theme';

export interface ThemeSwatch {
  hex: string;
  label: string;
}

export interface ThemeMeta {
  id: string;
  name: string;
  /** 英文名（风格库才有） */
  en?: string;
  /** 图标字（本站主题才有） */
  glyph?: string;
  hint?: string;
  dark: boolean;
  group: 'core' | 'gallery';
  swatches?: ThemeSwatch[];
}

/** 本站主题（站点的身份，排在风格库前面） */
export const CORE_THEMES: ThemeMeta[] = [
  { id: 'paper', name: '宣纸', glyph: '卷', hint: '亮色 · 纸白墨字，白天与投屏', dark: false, group: 'core' },
  { id: 'ink', name: '墨夜', glyph: '月', hint: '暗色 · 低刺激，夜间长读', dark: true, group: 'core' },
];

interface ManifestTheme {
  id: string;
  name: string;
  en: string;
  note?: string;
  dark: boolean;
  swatches: ThemeSwatch[];
}

/** 风格库主题（抓取生成，见 apps/web/src/design/styles-gallery.css） */
export const GALLERY_THEMES: ThemeMeta[] = (manifest as { themes: ManifestTheme[] }).themes.map((t) => ({
  id: t.id,
  name: t.name,
  en: t.en,
  hint: t.note,
  dark: t.dark,
  group: 'gallery' as const,
  swatches: t.swatches ?? [],
}));

export const ALL_THEMES: ThemeMeta[] = [...CORE_THEMES, ...GALLERY_THEMES];

export function themeMeta(id: string): ThemeMeta {
  return ALL_THEMES.find((t) => t.id === id) ?? CORE_THEMES[0];
}

function initialTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && ALL_THEMES.some((t) => t.id === saved)) return saved;
  } catch {
    /* 忽略 */
  }
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'ink' : 'paper';
}

interface ThemeContextValue {
  theme: string;
  meta: ThemeMeta;
  setTheme: (theme: string) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function flashTransition() {
  const root = document.documentElement;
  root.classList.add('theme-transition');
  window.setTimeout(() => root.classList.remove('theme-transition'), 180);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<string>(initialTheme);

  const setTheme = useCallback((next: string) => {
    setThemeState((prev) => {
      if (prev === next) return prev;
      flashTransition();
      return next;
    });
  }, []);

  /** 顶栏按钮与快捷键：在**全部**主题里挨个循环（本站主题 + 风格库，一共 ALL_THEMES.length 个） */
  const cycle = useCallback(() => {
    setThemeState((prev) => {
      // 找不到（比如 localStorage 里还存着已下线的主题）就从第一个重新开始
      const idx = ALL_THEMES.findIndex((t) => t.id === prev);
      const next = ALL_THEMES[(idx + 1) % ALL_THEMES.length];
      flashTransition();
      return next.id;
    });
  }, []);

  const meta = useMemo(() => themeMeta(theme), [theme]);

  // 落到 DOM + localStorage；data-dark 让组件知道该用深色处理（黑底图、无描边卡片等）
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.dark = meta.dark ? 'true' : 'false';
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* 忽略 */
    }
  }, [theme, meta.dark]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        cycle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycle]);

  const value = useMemo(() => ({ theme, meta, setTheme, cycle }), [theme, meta, setTheme, cycle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  return ctx;
}
