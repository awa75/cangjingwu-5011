/**
 * 分享对话框：为一个文件或文档生成免登录链接
 * 可设过期小时数与最大访问次数，留空即永久 / 不限次。
 */
import { useState } from 'react';
import { sharesApi } from '@/lib/api';
import { copyText } from '@/lib/format';
import { useToast } from '@/components/Toast';

interface ShareDialogProps {
  targetType: 'file' | 'document';
  targetId: string;
  targetTitle: string;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: '1 小时', value: 1 },
  { label: '24 小时', value: 24 },
  { label: '7 天', value: 168 },
  { label: '永久有效', value: 0 },
];

export function ShareDialog({ targetType, targetId, targetTitle, onClose }: ShareDialogProps) {
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [maxViews, setMaxViews] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { push } = useToast();

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const share = await sharesApi.create({
        targetType,
        targetId,
        expiresInHours: expiresInHours > 0 ? expiresInHours : null,
        maxViews: maxViews.trim() ? Number(maxViews) : null,
      });
      setUrl(share.url);
      await copyText(share.url).catch(() => undefined);
      push('分享链接已生成并复制', 'ok');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成分享失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="生成分享链接">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal card panel">
        <h3 className="title-marked">分享 · {targetTitle}</h3>
        <p className="dim">
          访客无需登录即可查看{targetType === 'document' ? '这篇文稿' : '这个文件'}；到期或被撤回后链接立即失效（410）。
        </p>

        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label htmlFor="share-expiry">有效期</label>
            <select
              id="share-expiry"
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="share-views">最大访问次数（留空不限）</label>
            <input
              id="share-views"
              type="number"
              min={1}
              placeholder="不限"
              value={maxViews}
              onChange={(e) => setMaxViews(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="notice notice-error">{error}</p>}

        {url && (
          <div className="share-result">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => copyText(url).then(() => push('已复制', 'ok'), () => push('复制失败', 'err'))}
            >
              复制
            </button>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {url ? '完成' : '取消'}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>
            {busy ? '生成中…' : url ? '再生成一条' : '生成链接'}
          </button>
        </div>
      </div>
    </div>
  );
}
