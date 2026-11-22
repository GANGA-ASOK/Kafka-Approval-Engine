import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FilePlus2, Inbox, ListChecks } from 'lucide-react';
import { useUser } from '../lib/auth-context';
import { cn } from '../lib/cn';
import { hoursLabel } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { useRequests, useStats, useWorkflows } from '../lib/queries';
import { conditionsText } from '../lib/rules';
import { PageHeader, Panel } from '../components/ui/Panel';
import { LinkButton } from '../components/ui/Button';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '../components/ui/Feedback';
import { RequestRow } from '../components/RequestRow';
import { StatusBar } from '../components/StatusBar';
import { ChainText } from '../components/RuleSummary';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Overview() {
  useDocumentTitle('Overview');
  const user = useUser();
  const approver = user.role !== 'EMPLOYEE';
  const stats = useStats();
  const inbox = useRequests({ scope: 'inbox', limit: 5 }, { live: true, enabled: approver });
  const mine = useRequests({ scope: 'mine', limit: 5 }, { live: true });
  const first = user.name.split(' ')[0];

  const s = stats.data;
  return (
    <>
      <PageHeader
        title={`${greeting()}, ${first}`}
        description={
          approver && !s
            ? 'Requests waiting for your decision and the ones you raised.'
            : approver && s
            ? s.inbox > 0
              ? `${s.inbox} ${s.inbox === 1 ? 'request is' : 'requests are'} waiting for your decision.`
              : "Nothing is waiting on you right now. Here's how things are moving."
            : 'Raise a request and follow it through each approval step.'
        }
        actions={
          <LinkButton to="/requests/new" variant="primary" icon={<FilePlus2 className="size-4" aria-hidden />}>
            New request
          </LinkButton>
        }
      />

      {/* KPI strip: one panel split by rules rather than a row of identical cards */}
      <section aria-label="Key numbers" className="mb-6 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
        {stats.isError ? (
          <ErrorState compact error={stats.error} onRetry={() => stats.refetch()} title="Couldn't load your numbers" />
        ) : (
          <dl className="flex flex-wrap gap-px bg-line">
            {approver && (
              <Kpi label="Waiting on you" value={s?.inbox} to="/inbox" emphasis={!!s?.inbox} hint="Open your inbox" />
            )}
            <Kpi label="Your open requests" value={s?.my_open} to="/requests" hint="Still in progress" />
            <Kpi label="Overdue steps" value={s?.breached} tone={s?.breached ? 'bad' : undefined} hint={s?.breached ? 'Escalated or late' : 'All on time'} />
            <Kpi label="Approved, last 7 days" value={s?.approved_last_7d} hint="Fully approved" />
            <Kpi label="Average time to decide" value={s ? hoursLabel(s.avg_cycle_hours) : undefined} hint="Submit to final decision" />
            {user.role === 'ADMIN' && (
              <Kpi label="Failed events" value={s?.dlq_pending} to="/admin/dlq" tone={s?.dlq_pending ? 'bad' : undefined} hint={s?.dlq_pending ? 'Need replay or discard' : 'Nothing stuck'} />
            )}
          </dl>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {approver && (
            <Panel
              title="Needs your action"
              description="Requests at your step, oldest deadline first."
              bodyClassName=""
              actions={
                <Link to="/inbox" className="text-sm font-medium text-accent hover:underline">
                  Open inbox
                </Link>
              }
            >
              {inbox.isPending ? (
                <SkeletonRows rows={3} />
              ) : inbox.isError ? (
                <ErrorState compact error={inbox.error} onRetry={() => inbox.refetch()} />
              ) : inbox.data.items.length === 0 ? (
                <EmptyState compact icon={<CheckCircle2 className="size-5" />} title="You're all caught up">
                  New requests that need a {user.role === 'ADMIN' ? 'decision' : 'decision from your role'} will appear here as soon as they're routed.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {inbox.data.items.map((r) => (
                    <RequestRow key={r.id} request={r} showRequester actions />
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel
            title="My recent requests"
            bodyClassName=""
            actions={
              <Link to="/requests" className="text-sm font-medium text-accent hover:underline">
                See all
              </Link>
            }
          >
            {mine.isPending ? (
              <SkeletonRows rows={3} />
            ) : mine.isError ? (
              <ErrorState compact error={mine.error} onRetry={() => mine.refetch()} />
            ) : mine.data.items.length === 0 ? (
              <EmptyState
                compact
                icon={<ListChecks className="size-5" />}
                title="You haven't raised any requests yet"
                action={
                  <LinkButton to="/requests/new" variant="primary" size="sm" icon={<FilePlus2 className="size-4" aria-hidden />}>
                    Raise your first request
                  </LinkButton>
                }
              >
                Tell us what you need and how much it costs. RELAY picks the approvers and keeps you posted.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {mine.data.items.map((r) => (
                  <RequestRow key={r.id} request={r} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Requests by status" description={approver ? 'Across the organisation.' : 'Your requests.'}>
            {stats.isPending ? <Skeleton className="h-16 w-full" /> : s ? <StatusBar byStatus={s.by_status ?? {}} /> : null}
          </Panel>
          <RoutingGuide />
          {approver && (
            <Link
              to="/inbox"
              className="flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-3.5 text-sm text-muted hover:border-accent hover:text-accent-ink lg:hidden"
            >
              <Inbox className="size-4" aria-hidden />
              Go to approvals inbox
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, hint, to, emphasis, tone }: { label: string; value: ReactNode; hint?: string; to?: string; emphasis?: boolean; tone?: 'bad' }) {
  const body = (
    <>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={cn('tnum mt-1 text-[28px] leading-none font-semibold', tone === 'bad' ? 'text-bad' : emphasis ? 'text-accent' : 'text-ink')}>
        {value === undefined ? <Skeleton className="h-7 w-12" /> : value}
      </dd>
      {hint && <dd className="mt-1.5 text-[12.5px] text-faint">{hint}</dd>}
    </>
  );
  const cls = cn('relative min-w-[150px] flex-1 basis-[150px] bg-surface px-5 py-4', emphasis && 'bg-accent-soft', to && 'transition-colors hover:bg-raised');
  return to ? (
    <div className={cls}>
      <Link to={to} className="absolute inset-0 focus-visible:-outline-offset-2" aria-label={`${label}: ${value ?? ''}`} />
      {body}
    </div>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Shows the live routing rules so people know where a request will go before raising it. */
function RoutingGuide() {
  const wfs = useWorkflows();
  const wf = wfs.data?.find((w) => w.active && w.request_type === 'PURCHASE') ?? wfs.data?.[0];
  return (
    <Panel title="Where requests go" description={wf ? `${wf.name}, version ${wf.version}` : 'Approval routes by amount.'}>
      {wfs.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : wfs.isError || !wf ? (
        <p className="text-sm text-muted">Routes appear here once workflows are set up.</p>
      ) : (
        <ol className="space-y-3">
          {[...wf.rules]
            .sort((a, b) => a.priority - b.priority)
            .map((rule) => (
              <li key={rule.name} className="rounded-lg bg-raised px-3 py-2.5">
                <p className="text-[13px] text-muted">{conditionsText(rule.conditions)}</p>
                <p className="mt-0.5 text-sm">
                  <ChainText roles={rule.steps.map((s) => s.role)} />
                </p>
              </li>
            ))}
        </ol>
      )}
    </Panel>
  );
}
