/**
 * 登录态（坞主与会员共用一套）
 *
 * **登录态不记忆**：令牌只存在内存里（lib/api.ts 的模块级变量），
 * 这里不读写 localStorage / sessionStorage —— 打开页面、刷新页面一律回到未登录。
 * 坞主身份由服务端按 .env 的 OWNER_USERNAME 判定，前端只看 user.isOwner。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser, RegisterInput } from '@cangjingwu/shared';
import { auth, authApi, onUnauthorized } from '@/lib/api';

interface AuthContextValue {
  /** 当前登录者（坞主或会员）；未登录为 null */
  user: AuthUser | null;
  /** 是否坞主（user.isOwner）—— 编辑台 / 审核台只对他开门 */
  isOwner: boolean;
  /** 等级 1..9（未登录为 0） */
  level: number;
  /** 登录态是否已确定（不记忆登录态，这里只是给页面一个统一的等待点） */
  ready: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // 令牌只在内存里，首帧就已经"没有登录态"了，所以 ready 直接是 true
  const [ready] = useState(true);

  // 401 时后端已把内存令牌清掉，这里同步清掉界面上的登录者
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    auth.set(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await authApi.register(input);
    auth.set(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    auth.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isOwner: Boolean(user?.isOwner),
      level: user?.level ?? 0,
      ready,
      login,
      register,
      logout,
    }),
    [user, ready, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
