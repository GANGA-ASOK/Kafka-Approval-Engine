import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { errorMessage, statusOf } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useDocumentTitle } from '../lib/hooks';
import { roleLabel, roleMeta } from '../lib/labels';
import type { Role } from '../lib/types';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { InlineError } from '../components/ui/Feedback';
import { AuthLayout } from './AuthLayout';

const DEMO_PASSWORD = 'Relay@123';
const DEMO: { email: string; name: string; role: Role; blurb: string }[] = [
  { email: 'employee@relay.dev', name: 'Esha Employee', role: 'EMPLOYEE', blurb: 'Raise and track requests' },
  { email: 'manager@relay.dev', name: 'Manoj Manager', role: 'MANAGER', blurb: 'First approval on everything' },
  { email: 'finance@relay.dev', name: 'Farah Finance', role: 'FINANCE', blurb: 'Signs off ₹10,000 and above' },
  { email: 'director@relay.dev', name: 'Dev Director', role: 'DIRECTOR', blurb: '₹1,00,000 and above, escalations' },
  { email: 'admin@relay.dev', name: 'Ada Admin', role: 'ADMIN', blurb: 'Workflows, failed events, users' },
];

export default function Login() {
  useDocumentTitle('Sign in');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (user) return <Navigate to={next} replace />;

  const signIn = async (em: string, pw: string, key: string) => {
    setBusy(key);
    setError(null);
    try {
      await login(em, pw);
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      const s = statusOf(err);
      setError(s === 401 || s === 400 ? "That email and password don't match. Check them and try again." : errorMessage(err));
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    signIn(email.trim(), password, 'form');
  };

  return (
    <AuthLayout>
      <div className="w-full max-w-[440px]">
        <h2 className="text-[26px] font-semibold text-ink">Sign in</h2>
        <p className="mt-1 text-muted">Use your work account, or try a demo account below.</p>

        <form onSubmit={onSubmit} className="mt-7 space-y-4">
          <Field label="Email">
            {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />}
          </Field>
          <Field label="Password">
            {(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === 'form'} disabled={!!busy} icon={<LogIn className="size-4" aria-hidden />}>
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          New here?{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create an employee account
          </Link>
        </p>

        <section aria-labelledby="demo-heading" className="mt-9">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="demo-heading" className="text-sm font-semibold text-ink">
              Demo accounts
            </h3>
            <span className="text-[12.5px] text-muted">
              Password <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink-2">{DEMO_PASSWORD}</code>
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted">One click signs you in as that role.</p>
          <ul className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
            {DEMO.map((d) => (
              <li key={d.email} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(DEMO_PASSWORD);
                    signIn(d.email, DEMO_PASSWORD, d.email);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised focus-visible:-outline-offset-2 disabled:opacity-60"
                >
                  <span className={cn('h-8 w-1 shrink-0 rounded-full', roleMeta[d.role].bg)} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{roleLabel(d.role)}</span>
                      <span className="truncate text-[13px] text-muted">{d.name}</span>
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">{d.blurb}</span>
                  </span>
                  <span className="text-[12.5px] font-medium text-accent">{busy === d.email ? 'Signing in…' : 'Sign in'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AuthLayout>
  );
}
