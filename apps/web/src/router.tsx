/**
 * 路由表（纯文库站）
 *   /              一律转到 /library（作品集首页已废弃）
 *   /library       文库（文件夹长条 + 文稿全部铺开）
 *   /library/:slug 阅读页
 *   /upload        投稿（任何登录者）
 *   /edit          坞主编辑台（文稿 / 文件夹 / 邀请码 / 问卷 / 站点文案）
 *   /review        坞主审核台（投稿放行 / 退回）
 *   /login         登录
 *   /register      会员注册（邀请码）
 *   /s/:token      免登录分享页
 *   /q/:token      问卷填答（免登录；站内无任何入口，只能靠坞主发链接）
 */
import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Loading } from '@/components/Bits';
import { Library } from '@/features/portfolio/Library';
import { Reader } from '@/features/portfolio/Reader';
import { UploadPage } from '@/features/portfolio/UploadPage';
import { LoginPage } from '@/features/portfolio/LoginPage';
import { RegisterPage } from '@/features/portfolio/RegisterPage';
import { SharePage } from '@/features/share/SharePage';

/* 坞主工具路由级懒加载：访客不为它们买单 */
const EditPage = lazy(() => import('@/features/edit/EditPage').then((m) => ({ default: m.EditPage })));
const ReviewPage = lazy(() =>
  import('@/features/review/ReviewPage').then((m) => ({ default: m.ReviewPage })),
);
/* 问卷填答页同理：站内没人会浏览到它，只有拿到链接的人才下载这段代码 */
const SurveyFillPage = lazy(() =>
  import('@/features/survey/SurveyFillPage').then((m) => ({ default: m.SurveyFillPage })),
);

function NotFound() {
  return (
    <div className="container page slim">
      <div className="notice">
        <h3>此处无卷</h3>
        <p>路径不存在或已归档。</p>
        <Link to="/library">回到文库 ›</Link>
      </div>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      {/* 问卷填答刻意不套 AppShell：作答者是被请来填表的，不该看到文库导航 */}
      <Route
        path="q/:token"
        element={
          <Suspense fallback={<Loading text="正在取问卷…" />}>
            <SurveyFillPage />
          </Suspense>
        }
      />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/library" replace />} />
        <Route path="library" element={<Library />} />
        <Route path="library/:slug" element={<Reader />} />
        <Route path="upload" element={<UploadPage />} />
        <Route
          path="edit"
          element={
            <Suspense fallback={<Loading text="打开编辑台…" />}>
              <EditPage />
            </Suspense>
          }
        />
        <Route
          path="review"
          element={
            <Suspense fallback={<Loading text="打开审核台…" />}>
              <ReviewPage />
            </Suspense>
          }
        />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="s/:token" element={<SharePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
