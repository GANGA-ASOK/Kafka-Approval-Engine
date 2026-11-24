import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { money, relative } from '../lib/format';
import { roleLabel } from '../lib/labels';
import { useAuth } from '../lib/auth-context';
import { decisionBlocker } from '../lib/permissions';
import { usePending } from '../lib/processing';
import { currentStep } from '../lib/sla';
import type { ApprovalRequest } from '../lib/types';
import { FINAL_STATUSES } from '../lib/types';
import { Avatar } from './Avatar';
import { StatusBadge } from './Badges';
import { DecisionControls } from './DecisionControls';
import { MiniRoute } from './RouteLine';
import { SlaChip } from './SlaChip';

/**
 * One request in a list. The title is a stretched link (whole row clickable) while the
 * inline Approve/Reject buttons stay independently focusable.
 */
export function RequestRow({ request: r, showRequester, actions }: { request: ApprovalRequest; showRequester?: boolean; actions?: boolean }) {
  const pending = usePending(r.id);
  const { user } = useAuth();
  const canDecide = !!actions && decisionBlocker(r, user) === null;
  const step = currentStep(r);
  const active = !FINAL_STATUSES.includes(r.status);
  return (
    <li className={cn('group relative @container px-5 py-4 transition-colors hover:bg-raised', pending && 'bg-warn-soft/40')}>
      {/* Container queries (not viewport breakpoints): the same row sits in narrow panels and full-width lists. */}
      <div className={cn('flex flex-col gap-3', actions ? '@4xl:flex-row @4xl:items-center @4xl:gap-5' : '@3xl:flex-row @3xl:items-center @3xl:gap-5')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {showRequester && <Avatar name={r.requester_name} className="mt-0.5" />}
        <div className="min-w-0">
          <Link to={`/requests/${r.id}`} className="font-semibold text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-accent group-hover:text-accent-ink">
            <span className="line-clamp-1">{r.title}</span>
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted">
            {showRequester && <span className="text-ink-2">{r.requester_name}</span>}
            <span>{r.department}</span>
            <span className="font-mono text-[12px] text-faint">{r.id}</span>
            <span>{relative(r.created_at)}</span>
          </div>
        </div>
      </div>

      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', actions ? '@4xl:grid @4xl:shrink-0 @4xl:gap-x-5 @4xl:grid-cols-[6.5rem_6.5rem_11rem_10.5rem]' : '@3xl:grid @3xl:shrink-0 @3xl:gap-x-5 @3xl:grid-cols-[6.5rem_6.5rem_11rem]')}>
        <span className="tnum text-[15px] font-semibold text-ink @3xl:text-right">{money(r.amount, r.currency)}</span>
        <div className="flex flex-col gap-1">
          <MiniRoute steps={r.steps} />
          {active && step && <span className="truncate text-[12px] text-muted">With {roleLabel(step.assigned_role)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 @3xl:flex-col @3xl:items-start">
          <StatusBadge status={r.status} processing={!!pending} />
          {active && step && !pending && <SlaChip dueAt={step.due_at} startedAt={step.started_at} breached={step.breached} />}
        </div>
        {actions && (
          <div className="relative z-10 @4xl:justify-self-end">
            {canDecide && !pending ? <DecisionControls request={r} size="sm" /> : null}
          </div>
        )}
      </div>
      </div>
    </li>
  );
}
