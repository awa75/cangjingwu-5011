/**
 * 通用零碎组件：加载中 / 错误 / 空状态 / 页头
 */
import type { ReactNode } from 'react';

export function Loading({ text = '取卷中…' }: { text?: string }) {
  return (
    <div className="center dim" style={{ padding: 'var(--sp-7) 0' }}>
      <div className="loading-seal" aria-hidden="true">
        {text}
      </div>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" style={{ margin: 'var(--sp-5) 0' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <span>{message}</span>
        {onRetry && (
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            重试
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-seal" aria-hidden="true">
        空
      </div>
      <h3>{title}</h3>
      {hint && <p className="dim">{hint}</p>}
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  code,
  extra,
}: {
  title: string;
  subtitle?: string;
  /** 标题前缀的等宽编号，如 卷一（CSS 里默认隐藏，见 base.css 的 .seal-no） */
  code?: string;
  extra?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1 className="title-marked">
          {code && <span className="seal-no">{code}</span>}
          {title}
        </h1>
        {subtitle && <p className="dim page-sub">{subtitle}</p>}
      </div>
      {extra && <div className="page-head-extra">{extra}</div>}
    </header>
  );
}
