import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useDocumentTitle } from '../lib/hooks';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { InlineError } from '../components/ui/Feedback';
import { AuthLayout } from './AuthLayout';
import { DEPARTMENTS } from '../lib/constants';

export default function Register() {
  useDocumentTitle('Create account');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', department: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const errors = {
    name: !form.name.trim() ? 'Enter your name.' : null,
    email: !/^\S+@\S+\.\S+$/.test(form.email) ? 'Enter a valid email address.' : null,
    password: form.password.length < 8 ? 'Use at least 8 characters.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await api.register({ name: form.name.trim(), email: form.email.trim(), password: form.password, department: form.department.trim() || undefined });
      await login(form.email.trim(), form.password);
      toast.success(`Welcome to RELAY, ${form.name.trim().split(' ')[0]}.`);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthLayout>
      <div className="w-full max-w-[440px]">
        <h2 className="text-[26px] font-semibold text-ink">Create your account</h2>
        <p className="mt-1 text-muted">New accounts can raise requests. An admin can give you an approver role later.</p>
        <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
          <Field label="Full name" error={touched ? errors.name : null}>
            {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set('name')} />}
          </Field>
          <Field label="Work email" error={touched ? errors.email : null}>
            {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@company.com" />}
          </Field>
          <Field label="Password" error={touched ? errors.password : null} hint="At least 8 characters.">
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
          </Field>
          <Field label="Department" optional hint="Used to route your requests.">
            {(p) => (
              <>
                <Input {...p} list="departments" value={form.department} onChange={set('department')} placeholder="e.g. Engineering" />
                <datalist id="departments">
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            Create account
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
