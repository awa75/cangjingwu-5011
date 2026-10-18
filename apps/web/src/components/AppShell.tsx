/**
 * 应用外壳：顶栏（公开导航 + 主题 + 身份区）+ 内容区 + 页脚
 *
 * 站点是**纯文库站**：公开导航只有「文库」「上传」两项。
 * 坞主额外看到「编辑」（编辑台）与「审核」（审核台）两个入口；
 * 访客未登录时右上角**什么都不显示**（没有登录按钮，登录靠直接访问 /login）。
 */
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { useAuth } from '@/hooks/useAuth';
import { useSite } from '@/hooks/useSite';

const PUBLIC_NAV = [
  { to: '/library', label: '文库' },
  { to: '/upload', label: '上传' },
];

export function AppShell() {
  const { site } = useSite();
  const { user, isOwner, logout } = useAuth();
  const location = useLocation();
  const isSharePage = location.pathname.startsWith('/s/');

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        跳到正文
      </a>

      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/library" className="brand">
            <span className="brand-mark" aria-hidden="true">
              藏
            </span>
            <span className="brand-text">
              <strong>{site.site_name}</strong>
              <em>{site.site_subtitle}</em>
            </span>
          </Link>

          <nav className="nav" aria-label="主导航">
            {PUBLIC_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `nav-link${isActive || location.pathname.startsWith(`${item.to}/`) ? ' is-active' : ''}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-right">
            <ThemeSwitch />

            {user ? (
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                {/* 坞主专属入口：编辑台与审核台 */}
                {isOwner && (
                  <>
                    <Link className="btn btn-sm btn-ghost" to="/edit">
                      编辑
                    </Link>
                    <Link className="btn btn-sm btn-ghost" to="/review">
                      审核
                    </Link>
                  </>
                )}
                <span className="dim mono" style={{ fontSize: 12 }} title={isOwner ? '坞主' : `LV${user.level}`}>
                  {user.username}
                </span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={logout}>
                  退出
                </button>
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main id="main" className={isSharePage ? 'main main-plain' : 'main'}>
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span>{site.footer_text}</span>
          <span className="footer-meta">
            {site.contact ? <span className="dim mono">{site.contact}</span> : null}
            {/* 备案号：按工信部要求放在页脚，并链接到 beian.miit.gov.cn */}
            <a
              className="footer-icp mono"
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noreferrer noopener"
              title="工业和信息化部政务服务平台 · ICP/IP地址/域名信息备案管理系统"
            >
              津ICP备2026013242号
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
