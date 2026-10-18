/**
 * 站点文案（/api/public/site）：站名、副标题、题记、页脚、协议编号
 * 全站只拉一次，放在 Provider 里共享。
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { SiteSettings } from '@cangjingwu/shared';
import { publicApi } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';

const FALLBACK: SiteSettings = {
  site_name: '藏经坞',
  site_subtitle: 'ZSR·DCM 协议养护计划',
  site_tagline: '收存所护，以契为凭',
  hero_text: '',
  footer_text: '藏经坞 · 数据不出坞',
  project_code: 'DCM-2026',
  contact: '',
};

const SiteContext = createContext<{ site: SiteSettings; loading: boolean; error: string | null }>({
  site: FALLBACK,
  loading: true,
  error: null,
});

export function SiteProvider({ children }: { children: ReactNode }) {
  const { data, loading, error } = useAsync(() => publicApi.site(), []);
  const site = data ? { ...FALLBACK, ...data } : FALLBACK;
  return <SiteContext.Provider value={{ site, loading, error }}>{children}</SiteContext.Provider>;
}

export function useSite() {
  return useContext(SiteContext);
}
