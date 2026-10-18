/**
 * 长图导出
 *
 * 两种模式：
 *   style = 'theme'     跟随当前浏览风格（文库阅读页默认；"和网页一模一样"那一档）
 *   style = 固定风格    瑞士国际主义 / 黑金 / 白金 —— 导出图自带配色，与站点主题无关
 *
 * 固定风格的做法：把要导出的节点**克隆到屏幕外**（left:-100000px），
 * 在克隆体上打 data-export-style，渲染成图后丢掉 ——
 * 屏幕上正在读的文章不会闪一下，也不会被临时改样。
 *
 * 各页面怎么用：
 *   文库阅读页  一键 style='theme'（所见即所得）
 *   说明页      弹层四选一（含 'theme'）
 *   分享页      style='theme' + forceTheme='paper'（固定亮色，避免深色长图分享观感差）
 */
import { toPng } from 'html-to-image';
import type { ThemeId } from '@cangjingwu/shared';
import type { ExportStyle } from './export-styles';

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** 临时把整站主题切成指定值（仅"跟随风格 + 强制某主题"时用） */
async function withTheme<T>(theme: ThemeId, fn: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  const before = root.dataset.theme;
  const beforeDark = root.dataset.dark;
  root.classList.remove('theme-transition');
  root.dataset.theme = theme;
  root.dataset.dark = theme === 'paper' ? 'false' : 'true';
  await nextFrame();
  try {
    return await fn();
  } finally {
    if (before) root.dataset.theme = before;
    if (beforeDark) root.dataset.dark = beforeDark;
    await nextFrame();
  }
}

/** 屏幕外克隆一份，并打上导出风格 */
function cloneOffscreen(
  node: HTMLElement,
  style: ExportStyle,
): { clone: HTMLElement; cleanup: () => void } {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${Math.round(
    node.getBoundingClientRect().width,
  )}px;pointer-events:none;z-index:-1;`;

  const clone = node.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.dataset.exportStyle = style;
  holder.appendChild(clone);
  document.body.appendChild(holder);

  return { clone, cleanup: () => holder.remove() };
}

export interface ExportImageOptions {
  /** 要导出的 DOM 节点 */
  node: HTMLElement;
  /** 下载文件名（不含扩展名） */
  fileName: string;
  /** 导出风格；默认跟随当前浏览风格 */
  style?: ExportStyle;
  /** 仅 style='theme' 时生效：导出期间临时切换整站主题（说明页固定 'paper'） */
  forceTheme?: ThemeId | null;
  /** 缩放倍率，2 = 高清 */
  pixelRatio?: number;
}

/** 把节点导出为 PNG 并触发下载；返回图片字节数 */
export async function exportNodeToPng(options: ExportImageOptions): Promise<number> {
  const { node, fileName, style = 'theme', forceTheme = null, pixelRatio = 2 } = options;

  const shoot = async (): Promise<number> => {
    let target: HTMLElement = node;
    let cleanup: () => void = () => undefined;

    if (style !== 'theme') {
      const made = cloneOffscreen(node, style);
      target = made.clone;
      cleanup = made.cleanup;
      await nextFrame();
      await nextFrame();
    }

    try {
      const bg = getComputedStyle(target).backgroundColor;
      const dataUrl = await toPng(target, {
        pixelRatio,
        cacheBust: true,
        backgroundColor:
          bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : getComputedStyle(document.body).backgroundColor,
        style: { margin: '0' },
      });
      const blob = await (await fetch(dataUrl)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.toLowerCase().endsWith('.png') ? fileName : `${fileName}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return blob.size;
    } finally {
      cleanup();
    }
  };

  if (style === 'theme' && forceTheme) return withTheme(forceTheme, shoot);
  return shoot();
}
