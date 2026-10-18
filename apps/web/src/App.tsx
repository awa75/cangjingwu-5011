/**
 * 应用根：Provider 组合 + 路由 + 滚动复位
 *
 * 开场动画已移除：根路径 `/` 直接进文库（重定向写在 router.tsx），
 * 不再有 EntryGate、iframe、sessionStorage 的「本次会话是否已进站」标记。
 */
import { useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '@/router';
import { ThemeProvider } from '@/hooks/useTheme';
import { AuthProvider } from '@/hooks/useAuth';
import { SiteProvider } from '@/hooks/useSite';
import { ToastProvider } from '@/components/Toast';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <SiteProvider>
            <AuthProvider>
              <ScrollToTop />
              <AppRoutes />
            </AuthProvider>
          </SiteProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
