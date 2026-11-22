import { roleLabel } from './labels';
import type { ApprovalRequest, Role, User } from './types';
import { FINAL_STATUSES } from './types';

/** Who can decide on the current step (mirrors the server-side check for a friendlier UI). */
export function decisionBlocker(r: ApprovalRequest, user: User | null): string | null {
  if (!user) return 'Sign in to act on this request.';
  if (FINAL_STATUSES.includes(r.status)) return 'This request is already closed.';
  if (r.status === 'SUBMITTED' || r.current_step == null) return 'Still choosing the approval route.';
  if (r.requester_id === user.id) return "You can't approve your own request.";
  if (user.role !== 'ADMIN' && user.role !== r.current_approver_role) {
    return `Waiting on ${roleLabel(r.current_approver_role)}. Your role (${roleLabel(user.role)}) can't decide this step.`;
  }
  return null;
}


export function canSeeInbox(role: Role | undefined) {
  return !!role && role !== 'EMPLOYEE';
}

export function canCancel(r: ApprovalRequest, user: User | null) {
  return !!user && (r.requester_id === user.id || user.role === 'ADMIN') && !FINAL_STATUSES.includes(r.status);
}
