import { Pencil, Plus, Siren, Workflow as WorkflowIcon } from 'lucide-react';
import { dateTime, slaLabel } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { humanize, roleLabel } from '../../lib/labels';
import { useWorkflows } from '../../lib/queries';
import { conditionsText } from '../../lib/rules';
import type { Role, Workflow } from '../../lib/types';
import { LinkButton } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { PageHeader } from '../../components/ui/Panel';
import { Badge, RoleBadge } from '../../components/Badges';

export default function Workflows() {
  useDocumentTitle('Workflows');
  const wfs = useWorkflows();
  return (
    <>
      <PageHeader
        title="Workflows"
        description="Rules that decide who approves a request. Rules are checked top to bottom and the first match wins. Edits apply to new requests; ones already in progress keep their route."
        actions={
          <LinkButton to="/admin/workflows/new" variant="primary" icon={<Plus className="size-4" aria-hidden />}>
            New workflow
          </LinkButton>
        }
      />
      {wfs.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
        </div>
      ) : wfs.isError ? (
        <ErrorState error={wfs.error} onRetry={() => wfs.refetch()} />
      ) : wfs.data.length === 0 ? (
        <EmptyState icon={<WorkflowIcon className="size-5" />} title="No workflows yet" action={<LinkButton to="/admin/workflows/new" variant="primary" size="sm">Create a workflow</LinkButton>}>
          Without a workflow every request goes to a Manager with a 24 hour deadline.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {wfs.data.map((wf) => (
            <WorkflowCard key={wf.id} wf={wf} />
          ))}
        </div>
      )}
    </>
  );
}

function WorkflowCard({ wf }: { wf: Workflow }) {
  const rules = [...wf.rules].sort((a, b) => a.priority - b.priority);
  const escalation = Object.entries(wf.escalation ?? {}) as [Role, Role | null][];
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">{wf.name}</h2>
            {wf.active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Paused</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            For {humanize(wf.request_type).toLowerCase()} requests. Version {wf.version}
            {wf.updated_at ? `, last changed ${dateTime(wf.updated_at)}` : ''}. <code className="font-mono text-[12px] text-faint">{wf.id}</code>
          </p>
        </div>
        <LinkButton to={`/admin/workflows/${encodeURIComponent(wf.id)}/edit`} size="sm" icon={<Pencil className="size-3.5" aria-hidden />}>
          Edit
        </LinkButton>
      </header>
      <ol className="divide-y divide-line">
        {rules.map((rule, i) => (
          <li key={`${rule.name}-${i}`} className="grid gap-3 px-5 py-4 md:grid-cols-[28px_minmax(200px,1fr)_2fr] md:items-center">
            <span className="tnum grid size-7 place-items-center rounded-full bg-sunken text-[12.5px] font-semibold text-muted" title="Checked in this order">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-ink">{rule.name}</p>
              <p className="text-[13px] text-muted">{conditionsText(rule.conditions)}</p>
            </div>
            <ol className="flex flex-wrap items-center gap-2" aria-label={`Approval chain for ${rule.name}`}>
              {rule.steps.map((s, j) => (
                <li key={j} className="flex items-center gap-2">
                  {j > 0 && <span className="h-[3px] w-5 rounded-full bg-line-strong" aria-hidden />}
                  <span className="inline-flex items-center gap-1.5">
                    <RoleBadge role={s.role} />
                    <span className="tnum text-[12.5px] text-muted">{slaLabel(s.sla_hours)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
      {escalation.length > 0 && (
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-raised px-5 py-3 text-[13px] text-muted rounded-b-[var(--radius-card)]">
          <span className="inline-flex items-center gap-1.5 font-medium text-ink-2">
            <Siren className="size-3.5 text-esc" aria-hidden />
            When a deadline passes
          </span>
          {escalation.map(([from, to]) => (
            <span key={from}>
              {roleLabel(from)} goes to <span className="font-medium text-ink-2">{to ? roleLabel(to) : 'nobody (stays put)'}</span>
            </span>
          ))}
        </footer>
      )}
    </article>
  );
}
