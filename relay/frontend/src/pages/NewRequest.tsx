import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Route, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, newIdempotencyKey } from '../lib/api';
import { useUser } from '../lib/auth-context';
import { DEPARTMENTS, REQUEST_TYPES } from '../lib/constants';
import { groupDigits, money, slaLabel } from '../lib/format';
import { useDebounced, useDocumentTitle } from '../lib/hooks';
import { roleLabel } from '../lib/labels';
import { refreshRequestQueries } from '../lib/processing';
import { useWorkflows } from '../lib/queries';
import { Button, LinkButton } from '../components/ui/Button';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import { InlineError } from '../components/ui/Feedback';
import { PageHeader, Panel } from '../components/ui/Panel';
import { RoutePreviewLine } from '../components/RouteLine';

const MAX_AMOUNT = 1_000_000_000;

export default function NewRequest() {
  useDocumentTitle('New request');
  const user = useUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const workflows = useWorkflows();
  // One key per form instance: a double-click or retry after a timeout can't create duplicates.
  const [idemKey] = useState(newIdempotencyKey);
  const [form, setForm] = useState({
    title: '',
    request_type: 'PURCHASE',
    amount: '',
    department: user.department ?? '',
    description: '',
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(form.amount.replace(/,/g, ''));
  const amountValid = form.amount !== '' && Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT;

  const errors = {
    title: form.title.trim().length < 3 ? 'Give it a short, specific title (at least 3 characters).' : null,
    amount: !form.amount ? 'Enter the amount in rupees.' : !amountValid ? (amount > MAX_AMOUNT ? 'That amount is too large.' : 'Enter an amount greater than zero.') : null,
    department: !form.department.trim() ? 'Choose the department paying for this.' : null,
    description: form.description.trim().length < 5 ? 'Explain what this is for, so approvers can decide quickly.' : null,
  };
  const show = (k: keyof typeof errors) => (touched[k] || submitted ? errors[k] : null);

  const typeOptions = useMemo(() => {
    const fromWorkflows = (workflows.data ?? []).map((w) => w.request_type);
    const seen = new Set<string>();
    return [...REQUEST_TYPES, ...fromWorkflows.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }))].filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  }, [workflows.data]);

  const previewParams = useDebounced(
    { amount: amountValid ? amount : null, department: form.department.trim(), request_type: form.request_type },
    400,
  );
  const preview = useQuery({
    queryKey: ['preview', previewParams],
    queryFn: () => api.preview({ amount: previewParams.amount!, department: previewParams.department || undefined, request_type: previewParams.request_type }),
    enabled: previewParams.amount != null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const previewStale = preview.isFetching || (amountValid && previewParams.amount !== amount);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) {
      const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRequest(
        {
          title: form.title.trim(),
          description: form.description.trim(),
          amount,
          currency: 'INR',
          department: form.department.trim(),
          request_type: form.request_type,
        },
        idemKey,
      );
      refreshRequestQueries(qc);
      toast.success('Request submitted', { description: 'Finding the right approvers now.' });
      navigate(`/requests/${created.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const steps = preview.data?.steps ?? [];
  const sameSla = steps.length > 0 && steps.every((s) => s.sla_hours === steps[0]!.sla_hours);

  return (
    <>
      <PageHeader title="New request" description="Describe what you need. You'll see who approves it before you submit." />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <Panel>
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <Field label="Title" error={show('title')} hint="What are you asking for? e.g. Laptops for two new joiners">
              {(p) => <Input {...p} value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} onBlur={blur('title')} />}
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Amount" error={show('amount')} hint={amountValid && amount >= 1000 ? `That's about ${money(amount, 'INR', { compact: true })}.` : 'In Indian rupees.'}>
                {(p) => (
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted" aria-hidden>
                      ₹
                    </span>
                    <Input
                      {...p}
                      inputMode="decimal"
                      autoComplete="off"
                      className="tnum pl-7"
                      placeholder="0"
                      value={form.amount}
                      onChange={(e) => set('amount', groupDigits(e.target.value))}
                      onBlur={blur('amount')}
                    />
                  </div>
                )}
              </Field>
              <Field label="Type">
                {(p) => (
                  <Select {...p} value={form.request_type} onChange={(e) => set('request_type', e.target.value)}>
                    {typeOptions.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Field label="Department" error={show('department')} hint="The team whose budget this comes from.">
              {(p) => (
                <>
                  <Input {...p} list="dept-options" value={form.department} onChange={(e) => set('department', e.target.value)} onBlur={blur('department')} />
                  <datalist id="dept-options">
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>

            <Field label="Why it's needed" error={show('description')} hint="Context helps approvers decide without coming back to you.">
              {(p) => (
                <Textarea
                  {...p}
                  rows={5}
                  maxLength={2000}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  onBlur={blur('description')}
                  placeholder="e.g. Two engineers join on 1 December. Quote from the approved vendor is attached in the ticket."
                />
              )}
            </Field>

            {error && <InlineError>{error}</InlineError>}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
              <LinkButton to="/requests" variant="ghost">
                Cancel
              </LinkButton>
              <Button type="submit" variant="primary" loading={busy} icon={<Send className="size-4" aria-hidden />}>
                Submit request
              </Button>
            </div>
          </form>
        </Panel>

        <aside className="lg:sticky lg:top-8" aria-live="polite" aria-busy={previewStale}>
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <Route className="size-4 text-accent" aria-hidden />
                Approval route
                {previewStale && amountValid && <Loader2 className="size-3.5 animate-spin text-muted" aria-label="Updating" />}
              </span>
            }
            description="Updates as you type."
          >
            {!amountValid ? (
              <p className="text-sm text-muted">Enter an amount to see who will approve this request and how long each step can take.</p>
            ) : preview.isError ? (
              <InlineError>{errorMessage(preview.error, "Couldn't work out the route.")} You can still submit; RELAY routes it when it arrives.</InlineError>
            ) : preview.data ? (
              <div className={previewStale ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                <p className="text-[15px] text-ink">
                  This will go to{' '}
                  <strong className="font-semibold">
                    {steps.map((s) => roleLabel(s.role)).join(' → ')}
                  </strong>
                  {sameSla ? ` (${slaLabel(steps[0]!.sla_hours)} SLA each).` : '.'}
                </p>
                <RoutePreviewLine className="mt-5" stations={steps} />
                <dl className="mt-5 space-y-1.5 border-t border-line pt-4 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Matched rule</dt>
                    <dd className="font-medium text-ink-2">{preview.data.rule_name ?? 'Default route'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Longest it can take</dt>
                    <dd className="tnum font-medium text-ink-2">{slaLabel(steps.reduce((a, s) => a + s.sla_hours, 0))}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">If a deadline passes</dt>
                    <dd className="font-medium text-ink-2">Escalates a level up</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="text-sm text-muted">Working out the route…</p>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
