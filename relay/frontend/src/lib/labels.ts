import {
  Ban,
  CheckCheck,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  FilePlus2,
  Flag,
  Gavel,
  type LucideIcon,
  Route,
  RotateCcw,
  ShieldAlert,
  Siren,
  TriangleAlert,
  Undo2,
  XOctagon,
  Hourglass,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import type { AuditEntry, RequestStatus, Role, StepStatus } from './types';
import { slaLabel } from './format';

/** One tone system used by badges, chips, timeline dots and the status bar. */
export type Tone = 'info' | 'ok' | 'bad' | 'esc' | 'warn' | 'neutral' | 'accent';

export const toneClasses: Record<Tone, { badge: string; dot: string; text: string; bar: string }> = {
  info: { badge: 'bg-info-soft text-info', dot: 'bg-info', text: 'text-info', bar: 'bg-info' },
  accent: { badge: 'bg-accent-soft text-accent-ink', dot: 'bg-accent', text: 'text-accent', bar: 'bg-accent' },
  ok: { badge: 'bg-ok-soft text-ok', dot: 'bg-ok', text: 'text-ok', bar: 'bg-ok' },
  bad: { badge: 'bg-bad-soft text-bad', dot: 'bg-bad', text: 'text-bad', bar: 'bg-bad' },
  esc: { badge: 'bg-esc-soft text-esc', dot: 'bg-esc', text: 'text-esc', bar: 'bg-esc' },
  warn: { badge: 'bg-warn-soft text-warn', dot: 'bg-amber', text: 'text-warn', bar: 'bg-amber' },
  neutral: { badge: 'bg-neutral-soft text-neutral', dot: 'bg-neutral', text: 'text-neutral', bar: 'bg-line-strong' },
};

export const statusMeta: Record<RequestStatus, { label: string; tone: Tone; icon: LucideIcon; hint: string }> = {
  SUBMITTED: { label: 'Submitted', tone: 'neutral', icon: Hourglass, hint: 'Received. Choosing the approval route.' },
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'info', icon: Clock, hint: 'Waiting for an approver to decide.' },
  ESCALATED: { label: 'Escalated', tone: 'esc', icon: Siren, hint: 'The approval deadline passed, so it moved up a level.' },
  APPROVED: { label: 'Approved', tone: 'ok', icon: CircleCheck, hint: 'Every step approved.' },
  REJECTED: { label: 'Rejected', tone: 'bad', icon: CircleX, hint: 'An approver turned it down.' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: Ban, hint: 'Withdrawn by the requester.' },
};

export function statusLabel(s: string) {
  return statusMeta[s as RequestStatus]?.label ?? humanize(s);
}

export const stepStatusMeta: Record<StepStatus, { label: string; tone: Tone }> = {
  WAITING: { label: 'Not started', tone: 'neutral' },
  PENDING: { label: 'In review', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  SKIPPED: { label: 'Skipped', tone: 'neutral' },
};

export const roleMeta: Record<Role, { label: string; text: string; bg: string; border: string; rank: number }> = {
  EMPLOYEE: { label: 'Employee', text: 'text-role-employee', bg: 'bg-role-employee', border: 'border-role-employee', rank: 0 },
  MANAGER: { label: 'Manager', text: 'text-role-manager', bg: 'bg-role-manager', border: 'border-role-manager', rank: 1 },
  FINANCE: { label: 'Finance', text: 'text-role-finance', bg: 'bg-role-finance', border: 'border-role-finance', rank: 2 },
  DIRECTOR: { label: 'Director', text: 'text-role-director', bg: 'bg-role-director', border: 'border-role-director', rank: 3 },
  ADMIN: { label: 'Admin', text: 'text-role-admin', bg: 'bg-role-admin', border: 'border-role-admin', rank: 4 },
};

export function roleLabel(r: string | null | undefined) {
  if (!r) return '—';
  return roleMeta[r as Role]?.label ?? humanize(r);
}

export const sourceMeta: Record<string, { label: string; description: string }> = {
  api: { label: 'API', description: 'Something a person did in the app' },
  'workflow-engine': { label: 'Workflow engine', description: 'Automatic routing and decisions' },
  'sla-monitor': { label: 'SLA monitor', description: 'Deadline checks running in the background' },
};

export function sourceLabel(s: string | null | undefined) {
  if (!s) return '—';
  return sourceMeta[s]?.label ?? humanize(s);
}

export const eventMeta: Record<string, { label: string; icon: LucideIcon; tone: Tone }> = {
  REQUEST_SUBMITTED: { label: 'Request submitted', icon: FilePlus2, tone: 'accent' },
  REQUEST_ROUTED: { label: 'Route chosen', icon: Route, tone: 'neutral' },
  STEP_ACTIVATED: { label: 'Step started', icon: CircleDot, tone: 'info' },
  APPROVAL_DECISION: { label: 'Decision recorded', icon: Gavel, tone: 'neutral' },
  STEP_APPROVED: { label: 'Step approved', icon: CircleCheck, tone: 'ok' },
  STEP_REJECTED: { label: 'Step rejected', icon: CircleX, tone: 'bad' },
  SLA_BREACHED: { label: 'Deadline missed', icon: TriangleAlert, tone: 'warn' },
  REQUEST_ESCALATED: { label: 'Escalated', icon: Siren, tone: 'esc' },
  REQUEST_APPROVED: { label: 'Request approved', icon: CheckCheck, tone: 'ok' },
  REQUEST_REJECTED: { label: 'Request rejected', icon: XOctagon, tone: 'bad' },
  REQUEST_CANCEL_REQUESTED: { label: 'Cancellation asked', icon: Undo2, tone: 'neutral' },
  REQUEST_CANCELLED: { label: 'Request cancelled', icon: Ban, tone: 'neutral' },
  EVENT_DEAD_LETTERED: { label: 'Event failed', icon: ShieldAlert, tone: 'bad' },
  EVENT_REPLAYED: { label: 'Event replayed', icon: RotateCcw, tone: 'accent' },
};

export function eventLabel(t: string) {
  return eventMeta[t]?.label ?? humanize(t);
}
export function eventIcon(t: string): LucideIcon {
  return eventMeta[t]?.icon ?? (t.includes('WORKFLOW') ? WorkflowIcon : Flag);
}

export function humanize(s: string) {
  const lower = s.replace(/[_-]+/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
function stepName(p: Record<string, unknown>) {
  const idx = num(p.step_index);
  return idx != null ? `step ${idx + 1}` : 'the step';
}

/** A plain-language sentence for an audit entry, used in the activity feed and audit table. */
export function describeEvent(e: AuditEntry): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const who = e.actor_name && e.actor_id !== 'system' ? e.actor_name : 'RELAY';
  switch (e.event_type) {
    case 'REQUEST_SUBMITTED':
      return `${who} submitted the request.`;
    case 'REQUEST_ROUTED': {
      const steps = Array.isArray(p.steps) ? (p.steps as { role?: string; sla_hours?: number }[]) : [];
      const chain = steps.map((s) => `${roleLabel(s.role)}${s.sla_hours != null ? ` (${slaLabel(s.sla_hours)})` : ''}`).join(', then ');
      const rule = str(p.rule_name);
      return `Routed${rule ? ` by the “${rule}” rule` : ''}${chain ? `: ${chain}.` : '.'}`;
    }
    case 'STEP_ACTIVATED': {
      const role = str(p.role);
      return `${capital(stepName(p))} is now with ${role ? roleLabel(role) : 'the approver'}.`;
    }
    case 'APPROVAL_DECISION': {
      const d = str(p.decision);
      const c = str(p.comment);
      return `${who} chose to ${d === 'REJECT' ? 'reject' : 'approve'} ${stepName(p)}${c ? `: “${c}”` : '.'}`;
    }
    case 'STEP_APPROVED':
      return `${who} approved ${stepName(p)}.`;
    case 'STEP_REJECTED':
      return `${who} rejected ${stepName(p)}.`;
    case 'SLA_BREACHED':
      return `${capital(stepName(p))} passed its deadline without a decision.`;
    case 'REQUEST_ESCALATED': {
      const from = str(p.from_role);
      const to = str(p.to_role);
      return to
        ? `Escalated from ${roleLabel(from)} to ${roleLabel(to)}.`
        : `Deadline passed with nobody higher to escalate to; it stays with ${roleLabel(from)}.`;
    }
    case 'REQUEST_APPROVED':
      return 'Fully approved. All steps are complete.';
    case 'REQUEST_REJECTED':
      return 'The request was rejected and the remaining steps were skipped.';
    case 'REQUEST_CANCEL_REQUESTED':
      return `${who} asked to cancel the request.`;
    case 'REQUEST_CANCELLED':
      return 'The request was cancelled.';
    case 'EVENT_DEAD_LETTERED': {
      const err = str(p.error) ?? str(p.last_error);
      return `An event failed after all retries and was set aside for an admin${err ? `: ${err}` : '.'}`;
    }
    case 'EVENT_REPLAYED':
      return `${who} replayed a failed event.`;
    default:
      return eventLabel(e.event_type);
  }
}

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
