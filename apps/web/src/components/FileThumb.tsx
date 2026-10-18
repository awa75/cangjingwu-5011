/**
 * 私有文件缩略图
 * <img src> 带不上 JWT 头，私有文件的 /media/thumbs 会 403；
 * 所以这里用 fetch 取回字节再转 blob URL，取不到就退回字形。
 */
import { useEffect, useState } from 'react';
import type { FileItem } from '@cangjingwu/shared';
import { auth } from '@/lib/api';

const GLYPH: Record<string, string> = {
  image: '▣',
  video: '▶',
  audio: '♫',
  doc: '▤',
  other: '◇',
};

export function FileThumb({ file, size = 'md' }: { file: FileItem; size?: 'sm' | 'md' }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (file.kind !== 'image') {
      setUrl(null);
      return;
    }
    const controller = new AbortController();
    let created: string | null = null;
    void (async () => {
      try {
        const fetchBlob = async (url: string): Promise<Blob | null> => {
          const res = await fetch(url, {
            headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined,
            signal: controller.signal,
          });
          return res.ok ? await res.blob() : null;
        };

        let blob = await fetchBlob(file.hasThumb ? file.thumbUrl : file.rawUrl);
        // 未收录的文件走公开 /media 一律 403（这是对的，不能松），
        // 退回带凭证的私有接口拿字节 —— 投稿人看自己的、坞主看全部都靠这条。
        if (!blob) blob = await fetchBlob(`/api/files/${file.id}/raw`);
        if (!blob) return;

        created = URL.createObjectURL(blob);
        setUrl(created);
      } catch {
        /* 取不到就退回字形 */
      }
    })();
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [file.id, file.hasThumb, file.thumbUrl, file.rawUrl, file.kind]);

  if (url) return <img className={`file-thumb file-thumb-${size}`} src={url} alt={file.originalName} loading="lazy" />;
  return (
    <span className={`file-thumb file-thumb-${size} file-thumb-glyph`} aria-hidden="true">
      {GLYPH[file.kind] ?? '◇'}
    </span>
  );
}
