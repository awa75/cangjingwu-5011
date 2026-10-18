/**
 * 会员注册（/register）：邀请码 + 用户名 + 密码
 *
 * 邀请码 18 位，三组「3 个字母 + 3 个数字」连写：KQZ111TRM802PLU913
 * 输入容错：空格、连字符、下划线、间隔点都会被忽略，字母自动转大写。
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSite } from '@/hooks/useSite';

/** 与后端同一套规则：去掉分隔符并转大写 */
const normalizeCode = (v: string) => v.replace(/[\s\-_·]/g, '').toUpperCase();

export function RegisterPage() {
  const { register, user, ready } = useAuth();
  const { site } = useSite();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const normalized = normalizeCode(code);
  const codeOk = /^(?:[A-Z]{3}\d{3}){3}$/.test(normalized);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!codeOk) {
      setError('注册码应为 18 位：三组「3 个字母 + 3 个数字」，例如 KQZ111TRM802PLU913');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      await register({ code: normalized, username: username.trim(), password, nickname: nickname.trim() });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setBusy(false);
    }
  };

  if (ready && user) return <Navigate to="/" replace />;

  return (
    <div className="container page login-page">
      <form className="card panel login-card" onSubmit={submit}>
        <div className="login-head">
          <span className="brand-mark" aria-hidden="true">
            藏
          </span>
          <h1 className="title-marked">{site.site_name}</h1>
          <p className="dim">凭契入坞，登记名号</p>
        </div>

        <div className="field">
          <label htmlFor="reg-code">注册码</label>
          <input
            id="reg-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className="mono"
            placeholder="KQZ111TRM802PLU913"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <span className="field-hint dim">
            {normalized.length === 0
              ? '18 位，三组「3 个字母 + 3 个数字」连写'
              : codeOk
                ? '格式正确'
                : `已输入 ${normalized.length} / 18 位`}
          </span>
          <span className="field-hint dim">如果这个注册码带初始余额，注册后会自动到账（在「我的」里能看到）</span>
        </div>

        <div className="field">
          <label htmlFor="reg-user">用户名</label>
          <input
            id="reg-user"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <span className="field-hint dim">2–24 位，可用中英文、数字、下划线、连字符</span>
        </div>

        <div className="field">
          <label htmlFor="reg-nick">昵称（可选）</label>
          <input
            id="reg-nick"
            type="text"
            autoComplete="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="reg-pass">密码</label>
          <input
            id="reg-pass"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <span className="field-hint dim">至少 8 位</span>
        </div>

        <div className="field">
          <label htmlFor="reg-pass2">确认密码</label>
          <input
            id="reg-pass2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {error && <p className="notice notice-error">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={busy || !code || !username || !password}>
          {busy ? '登记中…' : '注册并进坞'}
        </button>

        <p className="dim login-hint">
          已有账号？<Link to="/login">直接登录 ›</Link>
        </p>
      </form>
    </div>
  );
}
