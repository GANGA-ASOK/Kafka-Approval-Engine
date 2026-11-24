import { Check, Quote, Siren, TriangleAlert, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { roleLabel, roleMeta } from '../lib/labels';
import { dateTime, relative, slaLabel } from '../lib/format';
import { SlaChip } from './SlaChip';
import { StepStatusBadge } from './Badges';
import type { Role, Step, StepStatus } from '../lib/types';

/**
 * The RELAY "route line": a request's approval chain drawn like a transit line.
 * Each station is a step; the line fills in as steps are approved.
 */

interface Station {
  role: Role;
  sla_hours: number;
  status?: StepStatus;
  assigned_role?: Role;
  breached?: boolean;
}

function nodeClass(status: StepStatus | undefined, escalated: boolean, size: 'sm' | 'md') {
  const dims = size === 'sm' ? 'size-3' : 'size-5';
  switch (status) {
    case 'APPROVED':
      return cn(dims, 'bg-ok text-white dark:text-canvas');
    case 'REJECTED':
      return cn(dims, 'bg-bad text-white dark:text-canvas');
    case 'PENDING':
      return cn(dims, 'bg-surface border-[3px] animate-signal', escalated ? 'border-esc' : 'border-accent');
    case 'SKIPPED':
      return cn(dims, 'bg-surface border-2 border-dashed border-line-strong');
    default:
      return cn(dims, 'bg-surface border-2 border-line-strong');
  }
}

function segmentClass(prev: StepStatus | undefined) {
  return prev === 'APPROVED' ? 'bg-ok' : 'bg-line-strong';
}

/** Compact progress mini-stepper for list rows. */
export function MiniRoute({ steps, className }: { steps: Step[]; className?: string }) {
  if (!steps?.length) {
    return <span className="text-[12.5px] text-faint">Routing…</span>;
  }
  const done = steps.filter((s) => s.status === 'APPROVED').length;
  const current = steps.find((s) => s.status === 'PENDING');
  const label = `${done} of ${steps.length} steps approved${current ? `, now with ${roleLabel(current.assigned_role)}` : ''}`;
  return (
    <div className={cn('flex items-center', className)} role="img" aria-label={label} title={label}>
      {steps.map((s, i) => (
        <div key={s.index} className="flex items-center">
          {i > 0 && <span className={cn('h-0.5 w-4', segmentClass(steps[i - 1]?.status))} />}
          <span className={cn('block rounded-full', nodeClass(s.status, s.assigned_role !== s.role, 'sm'))} />
        </div>
      ))}
    </div>
  );
}

/** Larger horizontal route with labelled stations, used for the live route preview. */
export function RoutePreviewLine({ stations, className }: { stations: Station[]; className?: string }) {
  return (
    <ol className={cn('flex flex-wrap items-start gap-y-4', className)}>
      {stations.map((s, i) => {
        const m = roleMeta[s.role];
        return (
          <li key={`${s.role}-${i}`} className="flex items-start">
            {i > 0 && <span className="mt-[9px] h-[3px] w-8 rounded-full bg-line-strong sm:w-12" aria-hidden />}
            <div className="flex w-20 flex-col items-center text-center sm:w-24">
              <span className={cn('grid size-5 place-items-center rounded-full ring-4 ring-surface', m?.bg ?? 'bg-neutral')} aria-hidden>
                <span className="size-1.5 rounded-full bg-surface" />
              </span>
              <span className="mt-2 text-sm font-semibold text-ink">{roleLabel(s.role)}</span>
              <span className="tnum text-[12.5px] text-muted">{slaLabel(s.sla_hours)} to decide</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function StationNode({ status, escalated }: { status: StepStatus; escalated: boolean }) {
  return (
    <span className={cn('relative z-10 grid shrink-0 place-items-center rounded-full ring-4 ring-surface', nodeClass(status, escalated, 'md'))} aria-hidden>
      {status === 'APPROVED' && <Check className="size-3" strokeWidth={3} />}
      {status === 'REJECTED' && <X className="size-3" strokeWidth={3} />}
    </span>
  );
}

/** Vertical stepper for the request detail page. */
export function StepTrack({ steps, requestFinal }: { steps: Step[]; requestFinal: boolean }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const escalated = s.assigned_role !== s.role;
        const last = i === steps.length - 1;
        const prev = steps[i - 1];
        return (
          <li key={s.index} className="relative flex gap-4 pb-7 last:pb-0">
            {!last && <span className={cn('absolute top-5 bottom-0 left-[9px] w-[3px] rounded-full', segmentClass(s.status))} aria-hidden />}
            <StationNode status={s.status} escalated={escalated} />
            <div className="min-w-0 flex-1 -mt-0.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h3 className="text-[15px] font-semibold text-ink">{roleLabel(s.role)}</h3>
                <span className="text-[13px] text-faint">
                  Step {i + 1} of {steps.length}
                </span>
                <StepStatusBadge status={s.status} />
                {s.status === 'PENDING' && !requestFinal && <SlaChip dueAt={s.due_at} startedAt={s.started_at} breached={s.breached} />}
              </div>

              {escalated && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-esc-soft px-2 py-1 text-[13px] text-esc">
                  <Siren className="size-3.5" aria-hidden />
                  Escalated to {roleLabel(s.assigned_role)}
                  {s.escalation_level > 1 ? ` (level ${s.escalation_level})` : ''} after the deadline passed
                </p>
              )}
              {s.breached && !escalated && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-bad-soft px-2 py-1 text-[13px] text-bad">
                  <TriangleAlert className="size-3.5" aria-hidden />
                  Deadline missed; nobody higher to escalate to
                </p>
              )}

              <div className="mt-1.5 text-[13.5px] text-muted">
                {s.status === 'WAITING' && (
                  <p>
                    Starts after {prev ? roleLabel(prev.role) : 'routing'} approves. {slaLabel(s.sla_hours)} to decide once it starts.
                  </p>
                )}
                {s.status === 'PENDING' && (
                  <p>
                    With <span className={roleMeta[s.assigned_role]?.text}>{roleLabel(s.assigned_role)}</span> since {relative(s.started_at)}. Due {dateTime(s.due_at)}.
                  </p>
                )}
                {(s.status === 'APPROVED' || s.status === 'REJECTED') && (
                  <p>
                    <span className="font-medium text-ink-2">{s.acted_by_name ?? 'Someone'}</span> {s.status === 'APPROVED' ? 'approved' : 'rejected'} this{' '}
                    <time dateTime={s.acted_at ?? undefined} title={dateTime(s.acted_at)}>
                      {relative(s.acted_at)}
                    </time>
                    .
                  </p>
                )}
                {s.status === 'SKIPPED' && <p>Not needed because an earlier step was rejected or the request was cancelled.</p>}
              </div>

              {s.comment && (
                <blockquote className="mt-2.5 flex gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink-2">
                  <Quote className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="whitespace-pre-wrap">{s.comment}</span>
                </blockquote>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
