import { createContext, useContext } from 'react';
import type { Role, User } from './types';

export interface AuthState {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  logout: (reason?: 'expired') => void;
  hasRole: (...roles: Role[]) => boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Convenience: the signed-in user (only call under RequireAuth). */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called without a signed-in user');
  return user;
}

export const isApprover = (role: Role | undefined) => !!role && role !== 'EMPLOYEE';
