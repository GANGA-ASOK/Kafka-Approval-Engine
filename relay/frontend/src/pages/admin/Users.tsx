import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Users as UsersIcon, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../../lib/api';
import { DEPARTMENTS } from '../../lib/constants';
import { useDocumentTitle } from '../../lib/hooks';
import { roleLabel } from '../../lib/labels';
import { useUsers } from '../../lib/queries';
import type { Role } from '../../lib/types';
import { ROLES } from '../../lib/types';
import { Avatar } from '../../components/Avatar';
import { RoleBadge } from '../../components/Badges';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, InlineError, SkeletonRows } from '../../components/ui/Feedback';
import { Field, Input, Select } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/Panel';
import { Segmented } from '../../components/ui/Segmented';

export default function Users() {
  useDocumentTitle('Users');
  const users = useUsers();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'ALL' | Role>('ALL');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (users.data ?? []).filter(
      (u) => (role === 'ALL' || u.role === role) && (!term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term) || (u.department ?? '').toLowerCase().includes(term)),
    );
  }, [users.data, q, role]);

  const counts = useMemo(() => {
    const c: Partial<Record<Role, number>> = {};
    for (const u of users.data ?? []) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [users.data]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who can sign in, and what their role lets them do. Self sign-up creates employees; add approvers here."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)} icon={<UserPlus className="size-4" aria-hidden />}>
            Add user
          </Button>
        }
      />
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <Segmented
            label="Filter by role"
            value={role}
            onChange={setRole}
            options={[{ value: 'ALL' as const, label: 'All', count: users.data?.length }, ...ROLES.map((r) => ({ value: r, label: roleLabel(r), count: counts[r] ?? 0 }))]}
          />
          <div className="relative w-full lg:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input type="search" aria-label="Search users" placeholder="Search name, email, team" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {users.isPending ? (
          <SkeletonRows rows={5} />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => users.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-5" />} title="No users match">
            Try another name or role.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line bg-raised text-[12.5px] text-muted">
                <tr>
                  <th scope="col" className="py-2.5 pl-5 font-medium">Name</th>
                  <th scope="col" className="py-2.5 font-medium">Role</th>
                  <th scope="col" className="py-2.5 pr-5 font-medium">Department</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-raised">
                    <td className="py-3 pl-5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} role={u.role} />
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{u.name}</p>
                          <p className="truncate text-[13px] text-muted">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="py-3 pr-5 text-ink-2">{u.department || <span className="text-faint">Not set</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AddUserDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

const ROLE_HELP: Record<Role, string> = {
  EMPLOYEE: 'Raises and follows their own requests.',
  MANAGER: 'Approves the Manager step and sees all requests.',
  FINANCE: 'Approves the Finance step on larger amounts.',
  DIRECTOR: 'Approves the largest amounts and receives escalations.',
  ADMIN: 'Can decide any step and manage workflows, failed events and users.',
};

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  return `${Array.from(arr, (n) => chars[n % chars.length]).join('')}@1`;
}

function AddUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const empty = { name: '', email: '', password: '', role: 'MANAGER' as Role, department: '' };
  const [form, setForm] = useState(empty);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = {
    name: !form.name.trim() ? 'Enter a name.' : null,
    email: !/^\S+@\S+\.\S+$/.test(form.email) ? 'Enter a valid email.' : null,
    password: form.password.length < 8 ? 'At least 8 characters.' : null,
  };

  const close = () => {
    if (busy) return;
    setForm(empty);
    setTouched(false);
    setError(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      const u = await api.createUser({ ...form, name: form.name.trim(), email: form.email.trim(), department: form.department.trim() || undefined });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(`Added ${u.name ?? form.name} as ${roleLabel(form.role)}`, { description: 'Share the password with them securely.' });
      setBusy(false);
      close();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a user"
      description="They can sign in straight away with this email and password."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="add-user" variant="primary" loading={busy}>
            Add user
          </Button>
        </>
      }
    >
      <form id="add-user" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={touched ? errors.name : null}>
            {(p) => <Input {...p} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Email" error={touched ? errors.email : null}>
            {(p) => <Input {...p} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
          </Field>
        </div>
        <Field label="Role" hint={ROLE_HELP[form.role]}>
          {(p) => (
            <Select {...p} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Temporary password" error={touched ? errors.password : null}>
            {(p) => (
              <div className="flex gap-2">
                <Input {...p} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono text-[13px]" />
                <Button aria-label="Generate a password" title="Generate a password" onClick={() => setForm({ ...form, password: generatePassword() })} icon={<Wand2 className="size-4" aria-hidden />} />
              </div>
            )}
          </Field>
          <Field label="Department" optional>
            {(p) => (
              <>
                <Input {...p} list="user-depts" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
                <datalist id="user-depts">
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
        {error && <InlineError>{error}</InlineError>}
      </form>
    </Dialog>
  );
}
