/**
 * 导出长图的风格定义
 *
 * 四种：
 *   theme      跟随当前浏览的主题（默认选中）
 *   swiss      瑞士国际主义（International Typographic Style）
 *   blackgold  黑金
 *   whitegold  白金
 *
 * 这里只放"元数据"（名字、说明、色板），真正的样式在 design/export.css，
 * 两边靠 data-export-style 的取值对齐。
 */
export type ExportStyle = 'theme' | 'swiss' | 'blackgold' | 'whitegold';

export interface ExportStyleMeta {
  id: ExportStyle;
  name: string;
  hint: string;
  /** 预览用的色板：底 / 字 / 主强调 */
  swatch: [string, string, string];
  /** 是否深色（决定预览卡片的文字颜色） */
  dark: boolean;
}

export const EXPORT_STYLES: ExportStyleMeta[] = [
  {
    id: 'theme',
    name: '跟随当前风格',
    hint: '和你在网页上看到的一模一样（含当前主题的配色与纹理）',
    swatch: ['var(--bg)', 'var(--text)', 'var(--accent)'],
    dark: false,
  },
  {
    id: 'swiss',
    name: '瑞士国际主义',
    hint: '无衬线、左对齐、粗细分明的横线，一点瑞士红',
    swatch: ['#ffffff', '#16181d', '#e30613'],
    dark: false,
  },
  {
    id: 'blackgold',
    name: '黑金',
    hint: '墨黑底、契金字、居中衬线标题，适合夜里看',
    swatch: ['#0d0c0a', '#ece0c8', '#d4af37'],
    dark: true,
  },
  {
    id: 'whitegold',
    name: '白金',
    hint: '暖白纸底、古铜金描线，适合打印与分享',
    swatch: ['#fbf8f1', '#2b261c', '#a8862f'],
    dark: false,
  },
];

export function exportStyleMeta(id: ExportStyle): ExportStyleMeta {
  return EXPORT_STYLES.find((s) => s.id === id) ?? EXPORT_STYLES[0];
}
