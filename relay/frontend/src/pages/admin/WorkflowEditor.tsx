import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, FlaskConical, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { money, slaLabel } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { roleLabel } from '../../lib/labels';
import { useWorkflows } from '../../lib/queries';
import { conditionsText } from '../../lib/rules';
import type { Role, RuleConditions, Workflow, WorkflowRule } from '../../lib/types';
import { APPROVER_ROLES, ROLES } from '../../lib/types';
import { Button, LinkButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, InlineError, Skeleton } from '../../components/ui/Feedback';
import { Field, Input, Select } from '../../components/ui/Field';
import { PageHeader, Panel } from '../../components/ui/Panel';
import { ChainText } from '../../components/RuleSummary';

interface StepDraft {
  key: string;
  role: Role;
  sla: string;
}
interface RuleDraft {
  key: string;
  name: string;
  min: string;
  max: string;
  departments: string;
  types: string;
  steps: StepDraft[];
}
interface Draft {
  name: string;
  request_type: string;
  active: boolean;
  rules: RuleDraft[];
  escalation: Record<string, string>;
}

let seq = 0;
const k = () => `k${++seq}`;

function toDraft(wf: Workflow | undefined): Draft {
  if (!wf) {
    return {
      name: '',
      request_type: '',
      active: true,
      rules: [{ key: k(), name: 'All requests', min: '', max: '', departments: '', types: '', steps: [{ key: k(), role: 'MANAGER', sla: '24' }] }],
      escalation: { MANAGER: 'DIRECTOR', FINANCE: 'DIRECTOR', DIRECTOR: 'ADMIN', ADMIN: '' },
    };
  }
  return {
    name: wf.name,
    request_type: wf.request_type,
    active: wf.active,
    rules: [...wf.rules]
      .sort((a, b) => a.priority - b.priority)
      .map((r) => ({
        key: k(),
        name: r.name,
        min: r.conditions?.min_amount != null ? String(r.conditions.min_amount) : '',
        max: r.conditions?.max_amount != null ? String(r.conditions.max_amount) : '',
        departments: (r.conditions?.departments ?? []).join(', '),
        types: (r.conditions?.request_types ?? []).join(', '),
        steps: r.steps.map((s) => ({ key: k(), role: s.role, sla: String(s.sla_hours) })),
      })),
    escalation: Object.fromEntries(APPROVER_ROLES.map((role) => [role, wf.escalation?.[role] ?? ''])),
  };
}

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function toConditions(r: RuleDraft): RuleConditions {
  const c: RuleConditions = {};
  if (r.min !== '') c.min_amount = Number(r.min);
  if (r.max !== '') c.max_amount = Number(r.max);
  if (list(r.departments).length) c.departments = list(r.departments);
  if (list(r.types).length) c.request_types = list(r.types).map((t) => t.toUpperCase());
  return c;
}

function toRules(d: Draft): WorkflowRule[] {
  return d.rules.map((r, i) => ({
    name: r.name.trim(),
    priority: i + 1,
    conditions: toConditions(r),
    steps: r.steps.map((s) => ({ role: s.role, sla_hours: Number(s.sla) })),
  }));
}

type Errors = Record<string, string>;

function validate(d: Draft): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = 'Give the workflow a name.';
  if (!/^[A-Za-z_]+$/.test(d.request_type.trim())) e.request_type = 'Use letters and underscores only, e.g. PURCHASE.';
  if (d.rules.length === 0) e.rules = 'Add at least one rule.';
  const names = new Set<string>();
  d.rules.forEach((r) => {
    if (!r.name.trim()) e[`${r.key}.name`] = 'Name this rule.';
    else if (names.has(r.name.trim().toLowerCase())) e[`${r.key}.name`] = 'Another rule already has this name.';
    names.add(r.name.trim().toLowerCase());
    const min = r.min === '' ? null : Number(r.min);
    const max = r.max === '' ? null : Number(r.max);
    if (min != null && (!Number.isFinite(min) || min < 0)) e[`${r.key}.min`] = 'Must be zero or more.';
    if (max != null && (!Number.isFinite(max) || max <= 0)) e[`${r.key}.max`] = 'Must be more than zero.';
    if (min != null && max != null && min >= max) e[`${r.key}.max`] = 'Must be more than the minimum.';
    if (r.steps.length === 0) e[`${r.key}.steps`] = 'Add at least one approval step.';
    r.steps.forEach((s) => {
      const h = Number(s.sla);
      if (s.sla === '' || !Number.isFinite(h) || h <= 0) e[`${s.key}.sla`] = 'More than 0 hours.';
      else if (h > 24 * 90) e[`${s.key}.sla`] = 'At most 90 days.';
    });
  });
  Object.entries(d.escalation).forEach(([from, to]) => {
    if (to && to === from) e[`esc.${from}`] = "A role can't escalate to itself.";
  });
  return e;
}

/** Same matching as the backend (CONTRACT §3): priority order, min inclusive, max exclusive. */
function simulate(d: Draft, amount: number, department: string, type: string) {
  for (const r of d.rules) {
    const c = toConditions(r);
    if (c.min_amount != null && !(amount >= c.min_amount)) continue;
    if (c.max_amount != null && !(amount < c.max_amount)) continue;
    if (c.departments?.length && !c.departments.some((x) => x.toLowerCase() === department.trim().toLowerCase())) continue;
    if (c.request_types?.length && !c.request_types.includes(type.toUpperCase())) continue;
    return r;
  }
  return null;
}

export default function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const wfs = useWorkflows();
  const wf = wfs.data?.find((w) => w.id === id);
  useDocumentTitle(isNew ? 'New workflow' : `Edit ${wf?.name ?? 'workflow'}`);

  if (!isNew && wfs.isPending) return <Skeleton className="h-96" />;
  if (!isNew && wfs.isError) return <ErrorState error={wfs.error} onRetry={() => wfs.refetch()} />;
  if (!isNew && !wf) {
    return <EmptyState title="Workflow not found" action={<LinkButton to="/admin/workflows">Back to workflows</LinkButton>}>It may have been deleted.</EmptyState>;
  }
  return <Editor key={wf?.id ?? 'new'} wf={wf} />;
}

function Editor({ wf }: { wf: Workflow | undefined }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const initial = useMemo(() => toDraft(wf), [wf]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A ref, not state: navigate() right after saving must not be caught by the unsaved-changes blocker.
  const saved = useRef(false);
  const [test, setTest] = useState({ amount: '25000', department: 'Engineering', type: wf?.request_type ?? 'PURCHASE' });

  const errors = validate(draft);
  const err = (key: string) => (showErrors ? errors[key] : undefined);
  const dirty = JSON.stringify(stripKeys(draft)) !== JSON.stringify(stripKeys(initial));
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saved.current && currentLocation.pathname !== nextLocation.pathname);

  const patchRule = (key: string, patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, rules: d.rules.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const moveRule = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const rules = [...d.rules];
      const j = i + dir;
      if (j < 0 || j >= rules.length) return d;
      [rules[i], rules[j]] = [rules[j]!, rules[i]!];
      return { ...d, rules };
    });
  const patchSteps = (ruleKey: string, fn: (steps: StepDraft[]) => StepDraft[]) =>
    setDraft((d) => ({ ...d, rules: d.rules.map((r) => (r.key === ruleKey ? { ...r, steps: fn(r.steps) } : r)) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length) {
      setError(`Fix ${Object.keys(errors).length === 1 ? 'the highlighted field' : `the ${Object.keys(errors).length} highlighted fields`} before saving.`);
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: draft.name.trim(),
      request_type: draft.request_type.trim().toUpperCase(),
      active: draft.active,
      rules: toRules(draft),
      escalation: Object.fromEntries(Object.entries(draft.escalation).map(([r, t]) => [r, t || null])) as Workflow['escalation'],
    };
    try {
      const result = wf ? await api.updateWorkflow(wf.id, body) : await api.createWorkflow(body);
      saved.current = true;
      await qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['preview'] });
      toast.success(wf ? `Saved “${body.name}” as version ${result?.version ?? wf.version + 1}` : `Created “${body.name}”`, {
        description: 'New requests use it straight away. Requests in progress keep their current route.',
      });
      navigate('/admin/workflows');
    } catch (ex) {
      saved.current = false;
      setError(errorMessage(ex));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!wf) return;
    setBusy(true);
    try {
      await api.deleteWorkflow(wf.id);
      saved.current = true;
      await qc.invalidateQueries({ queryKey: ['workflows'] });
      toast.success(`Deleted “${wf.name}”`);
      navigate('/admin/workflows');
    } catch (ex) {
      saved.current = false;
      toast.error(errorMessage(ex));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const testAmount = Number(test.amount.replace(/,/g, ''));
  const matched = Number.isFinite(testAmount) && test.amount !== '' ? simulate(draft, testAmount, test.department, test.type) : undefined;

  return (
    <form onSubmit={submit} noValidate>
      <button type="button" onClick={() => navigate('/admin/workflows')} className="mb-4 inline-flex items-center gap-1 rounded text-sm font-medium text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        Workflows
      </button>
      <PageHeader
        title={wf ? `Edit ${wf.name}` : 'New workflow'}
        description={wf ? `Currently version ${wf.version}. Saving creates version ${wf.version + 1}.` : 'Define which rules route a request type, and who approves.'}
        actions={
          <>
            {wf && wf.id !== 'WF-DEFAULT-PURCHASE' && (
              <Button variant="ghost" className="text-bad" onClick={() => setConfirmDelete(true)} icon={<Trash2 className="size-4" aria-hidden />}>
                Delete
              </Button>
            )}
            <Button type="submit" variant="primary" loading={busy} icon={<Save className="size-4" aria-hidden />}>
              {wf ? 'Save changes' : 'Create workflow'}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <InlineError>{error}</InlineError>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Basics">
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-start">
              <Field label="Name" error={err('name')}>
                {(p) => <Input {...p} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Travel approvals" />}
              </Field>
              <Field label="Request type" error={err('request_type')} hint={!err('request_type') ? 'Which requests use it.' : undefined}>
                {(p) => (
                  <Input {...p} className="font-mono text-[13px] uppercase" value={draft.request_type} disabled={!!wf} onChange={(e) => setDraft({ ...draft, request_type: e.target.value.toUpperCase() })} placeholder="TRAVEL" />
                )}
              </Field>
              <label className="flex h-10 items-center gap-2.5 self-end text-sm font-medium text-ink-2 sm:mb-6">
                <input type="checkbox" className="size-4 accent-[var(--c-accent)]" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Active
              </label>
            </div>
          </Panel>

          <section aria-labelledby="rules-h" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="rules-h" className="text-[17px] font-semibold text-ink">
                  Rules
                </h2>
                <p className="text-[13px] text-muted">Checked in order; the first rule that matches decides the route. Leave a condition empty to match anything.</p>
              </div>
              <Button
                size="sm"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    rules: [...d.rules, { key: k(), name: `Rule ${d.rules.length + 1}`, min: '', max: '', departments: '', types: '', steps: [{ key: k(), role: 'MANAGER', sla: '24' }] }],
                  }))
                }
              >
                Add rule
              </Button>
            </div>
            {err('rules') && <InlineError>{err('rules')}</InlineError>}

            {draft.rules.map((r, i) => (
              <article key={r.key} className={cn('rounded-[var(--radius-card)] border bg-surface shadow-[var(--shadow-card)]', matched?.key === r.key ? 'border-accent ring-3 ring-accent/15' : 'border-line')}>
                <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                  <span className="tnum grid size-7 place-items-center rounded-full bg-sunken text-[12.5px] font-semibold text-muted" aria-label={`Rule ${i + 1}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{r.name || 'Untitled rule'}</p>
                    <p className="truncate text-[12.5px] text-muted">{conditionsText(toConditions(r))}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton label="Move rule up" disabled={i === 0} onClick={() => moveRule(i, -1)}>
                      <ArrowUp className="size-4" />
                    </IconButton>
                    <IconButton label="Move rule down" disabled={i === draft.rules.length - 1} onClick={() => moveRule(i, 1)}>
                      <ArrowDown className="size-4" />
                    </IconButton>
                    <IconButton label="Remove rule" danger onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((x) => x.key !== r.key) }))}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </header>
                <div className="grid gap-5 p-4 2xl:grid-cols-2">
                  <div className="space-y-4">
                    <Field label="Rule name" error={err(`${r.key}.name`)}>
                      {(p) => <Input {...p} value={r.name} onChange={(e) => patchRule(r.key, { name: e.target.value })} />}
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="From amount (₹)" optional error={err(`${r.key}.min`)} hint={!err(`${r.key}.min`) ? 'Includes this amount.' : undefined}>
                        {(p) => <Input {...p} inputMode="decimal" className="tnum" value={r.min} onChange={(e) => patchRule(r.key, { min: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />}
                      </Field>
                      <Field label="Below amount (₹)" optional error={err(`${r.key}.max`)} hint={!err(`${r.key}.max`) ? 'Up to, not including.' : undefined}>
                        {(p) => <Input {...p} inputMode="decimal" className="tnum" value={r.max} onChange={(e) => patchRule(r.key, { max: e.target.value.replace(/[^\d.]/g, '') })} placeholder="No limit" />}
                      </Field>
                    </div>
                    <Field label="Departments" optional hint="Comma separated. Empty means every department.">
                      {(p) => <Input {...p} value={r.departments} onChange={(e) => patchRule(r.key, { departments: e.target.value })} placeholder="Any department" />}
                    </Field>
                    <Field label="Request types" optional hint="Comma separated, e.g. PURCHASE, TRAVEL.">
                      {(p) => <Input {...p} className="uppercase placeholder:normal-case" value={r.types} onChange={(e) => patchRule(r.key, { types: e.target.value })} placeholder="Any type" />}
                    </Field>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[13px] font-medium text-ink-2">Approval steps, in order</p>
                      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => patchSteps(r.key, (s) => [...s, { key: k(), role: nextRole(s), sla: '24' }])}>
                        Add step
                      </Button>
                    </div>
                    {err(`${r.key}.steps`) && <InlineError>{err(`${r.key}.steps`)}</InlineError>}
                    <ol className="space-y-2">
                      {r.steps.map((s, j) => (
                        <li key={s.key} className="flex items-start gap-2 rounded-lg border border-line bg-raised p-2">
                          <span className="tnum mt-2 w-5 shrink-0 text-center text-[12.5px] font-semibold text-muted">{j + 1}</span>
                          <Select aria-label={`Step ${j + 1} approver role`} className="h-9 min-w-32 flex-1" value={s.role} onChange={(e) => patchSteps(r.key, (st) => st.map((x) => (x.key === s.key ? { ...x, role: e.target.value as Role } : x)))}>
                            {APPROVER_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {roleLabel(role)}
                              </option>
                            ))}
                          </Select>
                          <div className="w-28">
                            <div className="relative">
                              <Input
                                aria-label={`Step ${j + 1} deadline in hours`}
                                aria-invalid={err(`${s.key}.sla`) ? true : undefined}
                                inputMode="decimal"
                                className="tnum h-9 pr-8"
                                value={s.sla}
                                onChange={(e) => patchSteps(r.key, (st) => st.map((x) => (x.key === s.key ? { ...x, sla: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                              />
                              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] text-muted">h</span>
                            </div>
                            {err(`${s.key}.sla`) && <p className="mt-1 text-[12px] text-bad">{err(`${s.key}.sla`)}</p>}
                          </div>
                          <div className="flex">
                            <IconButton label="Move step up" disabled={j === 0} onClick={() => patchSteps(r.key, (st) => swap(st, j, j - 1))}>
                              <ArrowUp className="size-4" />
                            </IconButton>
                            <IconButton label="Move step down" disabled={j === r.steps.length - 1} onClick={() => patchSteps(r.key, (st) => swap(st, j, j + 1))}>
                              <ArrowDown className="size-4" />
                            </IconButton>
                            <IconButton label="Remove step" danger onClick={() => patchSteps(r.key, (st) => st.filter((x) => x.key !== s.key))}>
                              <Trash2 className="size-4" />
                            </IconButton>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {r.steps.length > 0 && (
                      <p className="mt-3 text-[13px] text-muted">
                        Route: <ChainText roles={r.steps.map((s) => s.role)} />
                        {r.steps.every((s) => Number(s.sla) > 0) && <span className="tnum"> (up to {slaLabel(r.steps.reduce((a, s) => a + Number(s.sla), 0))} in total)</span>}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </section>

          <Panel title="Escalation" description="Where a step goes when its deadline passes without a decision. Choose nobody to leave it with the same role, flagged as overdue.">
            <div className="grid gap-4 sm:grid-cols-2">
              {APPROVER_ROLES.map((from) => (
                <Field key={from} label={`When ${roleLabel(from)} is late, send to`} error={err(`esc.${from}`)}>
                  {(p) => (
                    <Select {...p} value={draft.escalation[from] ?? ''} onChange={(e) => setDraft({ ...draft, escalation: { ...draft.escalation, [from]: e.target.value } })}>
                      <option value="">Nobody (keep it with {roleLabel(from)})</option>
                      {ROLES.filter((r) => r !== from && r !== 'EMPLOYEE').map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="xl:sticky xl:top-8">
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <FlaskConical className="size-4 text-accent" aria-hidden />
                Try a request
              </span>
            }
            description="See which rule your unsaved changes would pick."
          >
            <div className="space-y-3">
              <Field label="Amount (₹)">{(p) => <Input {...p} inputMode="decimal" className="tnum" value={test.amount} onChange={(e) => setTest({ ...test, amount: e.target.value.replace(/[^\d.]/g, '') })} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Department">{(p) => <Input {...p} value={test.department} onChange={(e) => setTest({ ...test, department: e.target.value })} />}</Field>
                <Field label="Type">{(p) => <Input {...p} className="uppercase" value={test.type} onChange={(e) => setTest({ ...test, type: e.target.value.toUpperCase() })} />}</Field>
              </div>
              <div className="rounded-lg bg-raised px-3 py-3 text-sm" aria-live="polite">
                {matched === undefined ? (
                  <p className="text-muted">Enter an amount.</p>
                ) : matched ? (
                  <>
                    <p className="text-muted">
                      {money(testAmount)} matches <strong className="font-semibold text-ink">{matched.name || 'an untitled rule'}</strong>
                    </p>
                    <p className="mt-1">
                      <ChainText roles={matched.steps.map((s) => s.role)} />
                    </p>
                  </>
                ) : (
                  <p className="text-muted">No rule matches, so it falls back to a single Manager step with a 24h deadline.</p>
                )}
              </div>
            </div>
          </Panel>
        </aside>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title={`Delete “${wf?.name}”?`}
        description="New requests of this type will use the default purchase workflow instead. Requests in progress are not affected."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep workflow
            </Button>
            <Button variant="danger" loading={busy} onClick={remove}>
              Delete workflow
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">This can't be undone.</p>
      </Dialog>

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        size="sm"
        title="Leave without saving?"
        description="Your changes to this workflow will be lost."
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Discard changes
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">Save first if you want to keep them.</p>
      </Dialog>
    </form>
  );
}

function stripKeys(d: Draft) {
  return { ...d, rules: d.rules.map(({ key: _k, steps, ...r }) => ({ ...r, steps: steps.map(({ key: _s, ...s }) => s) })) };
}

function swap<T>(arr: T[], i: number, j: number) {
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  return copy;
}

function nextRole(steps: StepDraft[]): Role {
  const order: Role[] = ['MANAGER', 'FINANCE', 'DIRECTOR', 'ADMIN'];
  const last = steps[steps.length - 1]?.role;
  const idx = last ? order.indexOf(last) : -1;
  return order[Math.min(idx + 1, order.length - 1)]!;
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn('grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-sunken disabled:opacity-35 disabled:hover:bg-transparent', danger ? 'hover:text-bad' : 'hover:text-ink')}
    >
      {children}
    </button>
  );
}
