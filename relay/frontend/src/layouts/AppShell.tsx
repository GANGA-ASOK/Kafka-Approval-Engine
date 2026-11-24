import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  FilePlus2,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ScrollText,
  ServerCrash,
  Sun,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { cn } from '../lib/cn';
import { roleLabel, roleMeta } from '../lib/labels';
import { useStats } from '../lib/queries';
import { useTheme, type ThemePref } from '../lib/theme';
import type { Role } from '../lib/types';
import { Logo } from '../components/Logo';
import { HealthIndicator } from '../components/HealthIndicator';
import { buttonClass } from '../components/ui/styles';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: Role[];
  count?: number;
  end?: boolean;
}

export function AppShell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const stats = useStats();

  useEffect(() => setOpen(false), [location.pathname]);

  if (!user) return null;
  const approver = user.role !== 'EMPLOYEE';

  const main: NavItem[] = [
    { to: '/', label: 'Overview', icon: <LayoutDashboard className="size-4" />, end: true },
    { to: '/inbox', label: 'Approvals inbox', icon: <Inbox className="size-4" />, roles: ['MANAGER', 'FINANCE', 'DIRECTOR', 'ADMIN'], count: stats.data?.inbox },
    { to: '/requests', label: 'My requests', icon: <ListChecks className="size-4" />, end: true },
    { to: '/audit', label: 'Audit log', icon: <ScrollText className="size-4" /> },
  ];
  const admin: NavItem[] = [
    { to: '/admin/workflows', label: 'Workflows', icon: <Workflow className="size-4" /> },
    { to: '/admin/dlq', label: 'Failed events', icon: <ServerCrash className="size-4" />, count: stats.data?.dlq_pending },
    { to: '/admin/users', label: 'Users', icon: <Users className="size-4" /> },
  ];

  const visible = (items: NavItem[]) => items.filter((i) => !i.roles || i.roles.includes(user.role));

  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-rail px-3 py-5 text-rail-ink">
      <div className="flex items-center justify-between px-2">
        <NavLink to="/" aria-label="RELAY home" className="rounded-md">
          <Logo />
        </NavLink>
        <button type="button" className="grid size-9 place-items-center rounded-md text-rail-muted hover:bg-rail-hover lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="size-5" />
        </button>
      </div>

      <NavLink to="/requests/new" className={buttonClass('primary', 'md', 'mx-1 dark:bg-accent')}>
        <FilePlus2 className="size-4" aria-hidden />
        New request
      </NavLink>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto">
        <NavGroup items={visible(main)} />
        {user.role === 'ADMIN' && <NavGroup title="Administration" items={admin} />}
        {!approver && (
          <p className="mx-2 rounded-lg bg-white/[0.04] px-3 py-2.5 text-[12.5px] leading-relaxed text-rail-muted">
            You can raise requests and follow them here. Approvers see an inbox of requests waiting on them.
          </p>
        )}
      </nav>

      <div className="space-y-3">
        <HealthIndicator />
        <ThemeSwitch />
        <div className="flex items-center gap-3 rounded-lg px-2 py-1">
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-full border-2 bg-rail-active text-[12px] font-semibold text-white', roleMeta[user.role]?.border)} aria-hidden>
            {user.name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0])
              .join('')
              .toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="flex items-center gap-1.5 truncate text-[12px] text-rail-muted">
              <span className={cn('h-2.5 w-1 rounded-full', roleMeta[user.role]?.bg)} aria-hidden />
              {roleLabel(user.role)}
            </p>
          </div>
          <button type="button" onClick={() => logout()} className="grid size-9 place-items-center rounded-md text-rail-muted hover:bg-rail-hover hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-[var(--shadow-pop)]">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-rail px-4 lg:hidden">
        <NavLink to="/" aria-label="RELAY home">
          <Logo />
        </NavLink>
        <button type="button" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-md text-rail-ink hover:bg-rail-hover" aria-label="Open menu" aria-expanded={open}>
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(300px,86vw)] shadow-[var(--shadow-pop)]">{sidebar}</div>
        </div>
      )}

      <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-[1180px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavGroup({ title, items }: { title?: string; items: NavItem[] }) {
  return (
    <div>
      {title && <p className="mb-1.5 px-3 text-[12px] font-medium text-rail-muted">{title}</p>}
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'relative flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors',
                  isActive ? 'bg-rail-active text-white before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-amber' : 'text-rail-ink hover:bg-rail-hover hover:text-white',
                )
              }
            >
              <span aria-hidden className="opacity-90">
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.count ? (
                <span className="tnum rounded-full bg-amber px-2 text-[11.5px] leading-5 font-semibold text-[#2a1d00]" aria-label={`${item.count} waiting`}>
                  {item.count}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThemeSwitch() {
  const [pref, setPref] = useTheme();
  const opts: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="size-3.5" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="size-3.5" /> },
    { value: 'system', label: 'System', icon: <Monitor className="size-3.5" /> },
  ];
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-3 gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
      {opts.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[12px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
            pref === o.value ? 'bg-rail-active text-white' : 'text-rail-muted hover:text-rail-ink',
          )}
        >
          <input type="radio" name="theme" className="sr-only" checked={pref === o.value} onChange={() => setPref(o.value)} />
          <span aria-hidden>{o.icon}</span>
          {o.label}
        </label>
      ))}
    </div>
  );
}
