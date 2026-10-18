/**
 * Markdown 渲染
 * - marked 解析（GFM：表格、任务列表、删除线）
 * - DOMPurify 清洗：文档虽然只有管理员能写，但分享链接是公开面，仍然过一遍消毒
 * - 代码高亮用 highlight.js，在 DOM 落地后调用 highlightWithin()
 */
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';

const marked = new Marked({
  gfm: true,
  breaks: false,
});

/** markdown → 安全 HTML 字符串 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md ?? '', { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'script'],
  });
}

/** 对容器内所有 <pre><code> 上色（幂等） */
export function highlightWithin(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLElement>('pre code').forEach((block) => {
    if (block.dataset.highlighted === 'yes') return;
    try {
      hljs.highlightElement(block);
    } catch {
      /* 语言未注册时保持原样 */
    }
  });
}

/** 给正文里的外链加 noreferrer，避免分享页跳转泄露来源 */
export function hardenLinks(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
}

/** 从正文提取标题（用于自动生成 slug 或目录） */
export function extractHeadings(md: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  const re = /^(#{1,4})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md ?? '')) !== null) {
    out.push({ level: m[1].length, text: m[2].replace(/[#*`]/g, '').trim() });
  }
  return out;
}

/** 纯文本摘要（列表页用） */
export function plainExcerpt(md: string, max = 120): string {
  const text = (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
