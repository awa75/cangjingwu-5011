/**
 * Markdown 阅读视图
 * 渲染后过一遍代码高亮与外链加固；`indent` 打开首行缩进（中文排版习惯）。
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { hardenLinks, highlightWithin, renderMarkdown } from '@/lib/markdown';

interface MdViewerProps {
  markdown: string;
  indent?: boolean;
  className?: string;
  /** 需要导出长图时，把节点 ref 交给父组件 */
  containerRef?: RefObject<HTMLDivElement | null>;
}

export function MdViewer({ markdown, indent = false, className = '', containerRef }: MdViewerProps) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = containerRef ?? localRef;
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);

  useEffect(() => {
    highlightWithin(ref.current);
    hardenLinks(ref.current);
  }, [html, ref]);

  return (
    <div
      ref={ref}
      className={`md-viewer${indent ? ' is-indent' : ''} ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
