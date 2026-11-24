import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { roleLabel } from '../lib/labels';
import type { Role } from '../lib/types';
import { EmptyState } from '../components/ui/Feedback';
import { LinkButton } from '../components/ui/Button';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />;
  }
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return (
      <EmptyState
        icon={<ShieldX className="size-5" />}
        title="This area isn't available to your role"
        action={<LinkButton to="/">Back to overview</LinkButton>}
      >
        It's for {roles.map(roleLabel).join(', ')}. You're signed in as {roleLabel(user?.role)}.
      </EmptyState>
    );
  }
  return <>{children}</>;
}
