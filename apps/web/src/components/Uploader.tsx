/**
 * 拖拽上传器
 * - 支持多选、拖拽、粘贴（图片）
 * - 上传进度条（XHR，fetch 拿不到上传进度）
 * - 结果回调交给父页面决定「加入作品集 / 分享」
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { FileItem } from '@cangjingwu/shared';
import { filesApi, type UploadLimits } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useToast } from '@/components/Toast';

interface UploaderProps {
  onUploaded: (files: FileItem[]) => void;
  /** 只接受这些扩展名（不传则用后端白名单全量）；推演台用它把范围收紧到音视频 */
  onlyExtensions?: string[];
  /** 拖拽区里的说明文案 */
  hint?: string;
}

export function Uploader({ onUploaded, onlyExtensions, hint }: UploaderProps) {
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [queue, setQueue] = useState<File[]>([]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { push } = useToast();

  useEffect(() => {
    filesApi
      .limits()
      .then(setLimits)
      .catch(() => setLimits(null));
  }, []);

  const pick = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError('');
    setQueue(Array.from(list));
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };

  const allowed = onlyExtensions ?? limits?.acceptedExtensions ?? [];

  const validate = (files: File[]): string | null => {
    if (allowed.length > 0) {
      for (const f of files) {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        if (!allowed.includes(ext)) {
          return `不接受的类型：.${ext}${hint ? `（这里只收 ${hint}）` : ''}`;
        }
      }
    }
    if (!limits) return null;
    if (files.length > limits.maxFiles) return `一次最多上传 ${limits.maxFiles} 个文件`;
    for (const f of files) {
      if (f.size > limits.maxBytes) return `${f.name} 超过单文件上限 ${formatBytes(limits.maxBytes)}`;
    }
    return null;
  };

  const start = async () => {
    const bad = validate(queue);
    if (bad) {
      setError(bad);
      return;
    }
    setBusy(true);
    setPercent(0);
    setError('');
    try {
      const uploaded = await filesApi.upload(queue, setPercent);
      push(`已上传 ${uploaded.length} 个文件`, 'ok');
      setQueue([]);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded(uploaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
      setPercent(0);
    }
  };

  return (
    <div className="uploader">
      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        onPaste={(e) => pick(e.clipboardData.files)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
          accept={allowed.map((e) => `.${e}`).join(',')}
        />
        <div className="dropzone-glyph" aria-hidden="true">
          投
        </div>
        <strong>把文件拖进来，或点击选择</strong>
        <span className="dim">
          {hint ?? '图片 / 视频 / 音频 / md 文稿'}
          {limits && ` · 单文件上限 ${formatBytes(limits.maxBytes)} · 一次最多 ${limits.maxFiles} 个`}
        </span>
      </div>

      {queue.length > 0 && (
        <div className="queue">
          <ul className="queue-list">
            {queue.map((f) => (
              <li key={`${f.name}-${f.size}`}>
                <span className="mono dim">{formatBytes(f.size)}</span>
                <span>{f.name}</span>
              </li>
            ))}
          </ul>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setQueue([])}>
              清空
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={start}>
              {busy ? `上传中 ${percent}%` : `上传 ${queue.length} 个文件`}
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && <p className="notice notice-error">{error}</p>}
    </div>
  );
}
