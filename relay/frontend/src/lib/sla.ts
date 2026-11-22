import { duration, parseDate } from './format';
import type { ApprovalRequest, Step } from './types';
import { FINAL_STATUSES } from './types';

export type SlaLevel = 'ok' | 'soon' | 'breached';

export interface SlaState {
  level: SlaLevel;
  /** "5h 12m left", "Overdue by 3m" */
  label: string;
  remainingMs: number;
  due: Date;
}

/**
 * Green while more than 25% of the window (and > 1 minute) is left, amber when it's
 * close, red once it's past due or the backend has flagged the step as breached.
 */
export function slaState(dueAt: string | null | undefined, startedAt: string | null | undefined, _breachedFlag: boolean, now: number): SlaState | null {
  const due = parseDate(dueAt);
  if (!due) return null;
  const remainingMs = due.getTime() - now;
  const start = parseDate(startedAt);
  const windowMs = start ? Math.max(1, due.getTime() - start.getTime()) : 24 * 3600_000;
  if (remainingMs <= 0) {
    return { level: 'breached', label: `Overdue by ${duration(-remainingMs)}`, remainingMs, due };
  }
  const soon = remainingMs / windowMs < 0.25 || remainingMs < 60_000;
  return {
    // A step that was escalated keeps breached=true but gets a fresh deadline; colour by that deadline.
    level: soon ? 'soon' : 'ok',
    label: `${duration(remainingMs)} left`,
    remainingMs,
    due,
  };
}

export function currentStep(r: ApprovalRequest): Step | undefined {
  if (r.current_step == null) return undefined;
  return r.steps?.find((s) => s.index === r.current_step) ?? r.steps?.[r.current_step];
}

export function requestSla(r: ApprovalRequest, now: number): SlaState | null {
  if (FINAL_STATUSES.includes(r.status)) return null;
  const step = currentStep(r);
  return slaState(step?.due_at ?? r.sla_due_at, step?.started_at, step?.breached ?? false, now);
}
