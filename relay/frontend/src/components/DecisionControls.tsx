import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { money } from '../lib/format';
import { roleLabel } from '../lib/labels';
import { usePending, trackTransition } from '../lib/processing';
import type { ApprovalRequest, Decision } from '../lib/types';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field, Textarea } from './ui/Field';
import { InlineError } from './ui/Feedback';

export function DecisionControls({ request, size = 'md', stretch }: { request: ApprovalRequest; size?: 'sm' | 'md'; stretch?: boolean }) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const pending = usePending(request.id);

  if (pending && pending.kind !== 'CANCEL') {
    return (
      <span className="inline-flex h-8 items-center gap-2 rounded-full bg-warn-soft px-3 text-[13px] font-medium text-warn" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Processing your {pending.kind === 'APPROVE' ? 'approval' : 'rejection'}…
      </span>
    );
  }

  return (
    <>
      <div className={stretch ? 'grid grid-cols-2 gap-2' : 'flex gap-2'}>
        <Button variant="success" size={size} icon={<Check className="size-4" aria-hidden />} onClick={() => setDecision('APPROVE')}>
          Approve
        </Button>
        <Button variant="secondary" size={size} className="text-bad" icon={<X className="size-4" aria-hidden />} onClick={() => setDecision('REJECT')}>
          Reject
        </Button>
      </div>
      <DecisionDialog request={request} decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

function DecisionDialog({ request, decision, onClose }: { request: ApprovalRequest; decision: Decision | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reject = decision === 'REJECT';
  const commentError = reject && touched && !comment.trim() ? 'Tell the requester why, so they can fix and resubmit.' : null;
  const lastStep = request.current_step != null && request.current_step === request.steps.length - 1;
  const next = request.current_step != null ? request.steps[request.current_step + 1] : undefined;

  const close = () => {
    if (busy) return;
    setComment('');
    setTouched(false);
    setError(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!decision) return;
    if (reject && !comment.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.decide(request.id, decision, comment.trim() || undefined);
      trackTransition(qc, request, decision);
      toast(reject ? 'Rejection sent' : 'Approval sent', { description: 'Applying it now. This takes a second or two.' });
      setBusy(false);
      setComment('');
      setTouched(false);
      onClose();
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };

  const formId = `decision-${request.id}`;
  return (
    <Dialog
      open={decision !== null}
      onClose={close}
      size="md"
      title={reject ? 'Reject this request?' : 'Approve this request?'}
      description={
        <>
          “{request.title}” for <strong className="font-semibold text-ink">{money(request.amount, request.currency)}</strong> from {request.requester_name}.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Keep reviewing
          </Button>
          <Button type="submit" form={formId} variant={reject ? 'danger' : 'success'} loading={busy}>
            {reject ? 'Reject request' : 'Approve request'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-ink-2">
          {reject
            ? 'The request closes and any remaining steps are skipped. The requester sees your comment.'
            : lastStep
              ? 'This is the final step, so the request will be fully approved.'
              : `It then moves on to ${roleLabel(next?.role)} for the next decision.`}
          {user?.role === 'ADMIN' && user.role !== request.current_approver_role && ' You are deciding as an admin on behalf of ' + roleLabel(request.current_approver_role) + '.'}
        </p>
        <Field label={reject ? 'Reason for rejecting' : 'Comment'} optional={!reject} error={commentError} hint={reject ? 'Required.' : 'Shown on the request and in the audit log.'}>
          {(p) => (
            <Textarea
              {...p}
              autoFocus
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={reject ? 'e.g. Please attach the vendor quote and resubmit.' : 'e.g. Within budget for Q4.'}
              maxLength={1000}
            />
          )}
        </Field>
        {error && <InlineError>{error}</InlineError>}
      </form>
    </Dialog>
  );
}
