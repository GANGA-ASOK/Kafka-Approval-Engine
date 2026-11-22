import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, onUnauthorized, session } from './api';
import { AuthContext, type AuthState } from './auth-context';
import type { Role, User } from './types';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => (session.token() ? session.user() : null));
  const navigate = useNavigate();
  const qc = useQueryClient();

  const logout = useCallback(
    (reason?: 'expired') => {
      session.clear();
      setUser(null);
      qc.clear();
      if (reason === 'expired') {
        toast.info('Your session ended. Sign in again to continue.', { id: 'session-expired' });
        const next = window.location.pathname + window.location.search;
        navigate(`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`, { replace: true });
      } else {
        navigate('/login', { replace: true });
      }
    },
    [navigate, qc],
  );

  useEffect(() => {
    onUnauthorized(() => logout('expired'));
    return () => onUnauthorized(null);
  }, [logout]);

  // Refresh the cached profile once per load (role changes, renamed users).
  useEffect(() => {
    if (!session.token()) return;
    api
      .me()
      .then((u) => {
        session.saveUser(u);
        setUser(u);
      })
      .catch(() => {
        /* 401 handled by interceptor; network errors keep the cached user */
      });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user: u } = await api.login(email, password);
      session.save(token, u);
      qc.clear();
      setUser(u);
      return u;
    },
    [qc],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      login,
      logout,
      hasRole: (...roles: Role[]) => !!user && roles.includes(user.role),
    }),
    [user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
