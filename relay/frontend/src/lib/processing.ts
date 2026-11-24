import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';
import { roleLabel, statusLabel } from './labels';
import type { ApprovalRequest } from './types';
import { FINAL_STATUSES } from './types';

/**
 * Decisions and cancellations return 202: the change happens later, when the workflow
 * engine consumes the Kafka event. This store remembers which requests are "in flight"
 * so every screen can show "Processing…", and polls until the request document changes.
 */
export type PendingKind = 'APPROVE' | 'REJECT' | 'CANCEL';
interface Pending {
  kind: PendingKind;
  since: number;
}

const POLL_MS = 1200;
const GIVE_UP_MS = 30_000;

let pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function set(id: string, value: Pending | null) {
  const next = new Map(pending);
  if (value) next.set(id, value);
  else next.delete(id);
  pending = next;
  emit();
}

export function usePending(id: string | undefined): Pending | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (id ? pending.get(id) : undefined),
    () => undefined,
  );
}

export function usePendingCount() {
  return useSyncExternalStore(subscribe, () => pending.size, () => 0);
}

function changed(before: ApprovalRequest, after: ApprovalRequest) {
  return (
    after.version !== before.version ||
    after.status !== before.status ||
    after.current_step !== before.current_step
  );
}

function outcomeMessage(kind: PendingKind, r: ApprovalRequest) {
  if (kind === 'CANCEL') {
    return r.status === 'CANCELLED'
      ? { type: 'success' as const, text: `Cancelled “${r.title}”.` }
      : { type: 'info' as const, text: `“${r.title}” is now ${statusLabel(r.status).toLowerCase()}.` };
  }
  if (kind === 'REJECT') {
    return r.status === 'REJECTED'
      ? { type: 'success' as const, text: `Rejected “${r.title}”. ${r.requester_name} can see your comment.` }
      : { type: 'info' as const, text: `“${r.title}” is now ${statusLabel(r.status).toLowerCase()}.` };
  }
  if (r.status === 'APPROVED') return { type: 'success' as const, text: `Approved. “${r.title}” is fully approved.` };
  if (r.current_approver_role && !FINAL_STATUSES.includes(r.status)) {
    return { type: 'success' as const, text: `Approved. “${r.title}” moved on to ${roleLabel(r.current_approver_role)}.` };
  }
  return { type: 'info' as const, text: `“${r.title}” is now ${statusLabel(r.status).toLowerCase()}.` };
}

export function refreshRequestQueries(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: ['requests'] });
  qc.invalidateQueries({ queryKey: ['stats'] });
  qc.invalidateQueries({ queryKey: ['audit'] });
  if (id) {
    qc.invalidateQueries({ queryKey: ['request', id] });
    qc.invalidateQueries({ queryKey: ['timeline', id] });
  }
}

/** Start tracking an accepted (202) action on `before` and poll until it lands. */
export function trackTransition(qc: QueryClient, before: ApprovalRequest, kind: PendingKind) {
  const id = before.id;
  set(id, { kind, since: Date.now() });
  const started = Date.now();

  const tick = async () => {
    if (!pending.has(id)) return;
    try {
      const after = await api.getRequest(id);
      if (changed(before, after)) {
        set(id, null);
        qc.setQueryData(['request', id], after);
        refreshRequestQueries(qc, id);
        const msg = outcomeMessage(kind, after);
        if (msg.type === 'success') toast.success(msg.text);
        else toast.info(msg.text);
        return;
      }
    } catch {
      /* transient — keep polling until the deadline */
    }
    if (Date.now() - started > GIVE_UP_MS) {
      set(id, null);
      refreshRequestQueries(qc, id);
      toast.info('Still processing. The event is queued and will apply shortly; this page refreshes on its own.');
      return;
    }
    window.setTimeout(tick, POLL_MS);
  };
  window.setTimeout(tick, 600);
}
