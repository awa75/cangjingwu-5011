/**
 * 登录页（/login）
 *
 * 全站唯一的登录入口 —— 顶栏不再放登录按钮，只能从「上传」或「编辑」点进来，
 * 也可以直接访问本页。坞主与会员共用此页：登录后由 /api/auth/me 的 isOwner
 * 决定顶栏额外出现哪些入口（编辑 / 审核）。
 *
 * 令牌只存在内存里，不落 localStorage/sessionStorage —— 刷新即回到未登录。
 */
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSite } from '@/hooks/useSite';

export function LoginPage() {
  const { login, user, ready } = useAuth();
  const { site } = useSite();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const redirect = new URLSearchParams(location.search).get('redirect') ?? '/';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  if (ready && user) return <Navigate to={redirect} replace />;

  return (
    <div className="container page login-page">
      <form className="card panel login-card" onSubmit={submit}>
        <div className="login-head">
          <span className="brand-mark" aria-hidden="true">
            藏
          </span>
          <h1 className="title-marked">{site.site_name}</h1>
          <p className="dim">持契者入坞</p>
        </div>

        <div className="field">
          <label htmlFor="login-user">账号</label>
          <input
            id="login-user"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="login-pass">密码</label>
          <input
            id="login-pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="notice notice-error">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={busy || !username || !password}>
          {busy ? '验契中…' : '登录'}
        </button>

        <p className="dim login-hint">
          还没有契？<Link to="/register">用注册码注册 ›</Link>
        </p>
      </form>
    </div>
  );
}
