import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FileQuestion, Loader2, ScrollText, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, statusOf } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { dateTime, money, relative } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { humanize, roleLabel, statusMeta } from '../lib/labels';
import { canCancel, decisionBlocker } from '../lib/permissions';
import { trackTransition, usePending } from '../lib/processing';
import { useRequest, useTimeline } from '../lib/queries';
import { currentStep } from '../lib/sla';
import type { ApprovalRequest } from '../lib/types';
import { FINAL_STATUSES } from '../lib/types';
import { Button, LinkButton } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState, ErrorState, InlineError, Skeleton } from '../components/ui/Feedback';
import { Panel } from '../components/ui/Panel';
import { Avatar } from '../components/Avatar';
import { RoleBadge, StatusBadge } from '../components/Badges';
import { DecisionControls } from '../components/DecisionControls';
import { ActivityFeed } from '../components/ActivityFeed';
import { SlaChip } from '../components/SlaChip';
import { StepTrack } from '../components/RouteLine';

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useRequest(id);
  const r = query.data;
  useDocumentTitle(r?.title ?? 'Request');

  const back = (
    <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/requests'))} className="mb-4 inline-flex items-center gap-1 rounded text-sm font-medium text-muted hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden />
      Back
    </button>
  );

  if (query.isPending) {
    return (
      <>
        {back}
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="mt-3 h-5 w-1/3" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {back}
        {statusOf(query.error) === 404 ? (
          <EmptyState icon={<FileQuestion className="size-5" />} title="Request not found" action={<LinkButton to="/requests">Go to my requests</LinkButton>}>
            It may have been removed, or the link has a typo: <code className="font-mono text-[13px]">{id}</code>
          </EmptyState>
        ) : statusOf(query.error) === 403 ? (
          <EmptyState icon={<FileQuestion className="size-5" />} title="You can't view this request" action={<LinkButton to="/requests">Go to my requests</LinkButton>}>
            Only the requester and approvers can open it.
          </EmptyState>
        ) : (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        )}
      </>
    );
  }
  if (!r) return null;
  return (
    <>
      {back}
      <DetailBody r={r} />
    </>
  );
}

function DetailBody({ r }: { r: ApprovalRequest }) {
  const { user } = useAuth();
  const pending = usePending(r.id);
  const final = FINAL_STATUSES.includes(r.status);
  const timeline = useTimeline(r.id, !final || !!pending);
  const { refetch: refetchTimeline } = timeline;
  // Each state transition writes new audit entries: refresh the feed when the version moves.
  useEffect(() => {
    refetchTimeline();
  }, [r.version, refetchTimeline]);
  const step = currentStep(r);
  const blocker = decisionBlocker(r, user);
  const approverView = user?.role !== 'EMPLOYEE';
  const done = r.steps.filter((s) => s.status === 'APPROVED').length;

  return (
    <>
      <header className="mb-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge status={r.status} processing={!!pending} />
          {!final && step && !pending && <SlaChip dueAt={step.due_at} startedAt={step.started_at} breached={step.breached} />}
          <span className="font-mono text-[12.5px] text-faint">{r.id}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <h1 className="max-w-3xl text-[28px] leading-tight font-semibold text-ink">{r.title}</h1>
          <p className="tnum text-[28px] leading-tight font-semibold text-ink">{money(r.amount, r.currency)}</p>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div className="flex items-center gap-2.5">
            <Avatar name={r.requester_name} />
            <div>
              <dt className="text-[12.5px] text-muted">Requested by</dt>
              <dd className="font-medium text-ink">{r.requester_name}</dd>
            </div>
          </div>
          <Meta label="Department" value={r.department} />
          <Meta label="Type" value={humanize(r.request_type)} />
          <Meta label="Submitted" value={<time title={dateTime(r.created_at)}>{relative(r.created_at)}</time>} />
          {r.completed_at && <Meta label="Closed" value={<time title={dateTime(r.completed_at)}>{relative(r.completed_at)}</time>} />}
        </dl>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Approval route"
            description={
              r.steps.length
                ? `${done} of ${r.steps.length} ${r.steps.length === 1 ? 'step' : 'steps'} approved${r.rule_name ? `. Matched the “${r.rule_name}” rule` : ''}${r.workflow_version ? ` (workflow v${r.workflow_version})` : ''}.`
                : undefined
            }
          >
            {r.steps.length === 0 ? (
              r.status === 'SUBMITTED' ? (
                <p className="flex items-center gap-2.5 text-sm text-muted">
                  <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
                  Choosing the approvers. This usually takes a second.
                </p>
              ) : (
                <p className="text-sm text-muted">No approval steps were needed.</p>
              )
            ) : (
              <StepTrack steps={r.steps} requestFinal={final} />
            )}
          </Panel>

          <Panel title="Details">
            <p className="max-w-prose text-[15px] leading-relaxed whitespace-pre-wrap text-ink-2">{r.description || 'No description given.'}</p>
          </Panel>
        </div>

        <div className="space-y-6">
          <ActionPanel r={r} blocker={blocker} approverView={approverView} />

          <Panel
            title="Activity"
            description={final ? 'Full history of this request.' : 'Updates live while the request is open.'}
            actions={
              <Link to={`/audit?request_id=${encodeURIComponent(r.id)}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
                <ScrollText className="size-3.5" aria-hidden />
                Audit log
              </Link>
            }
          >
            {timeline.isPending ? (
              <div className="space-y-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="size-7 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-4/5" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : timeline.isError ? (
              <ErrorState compact error={timeline.error} onRetry={() => timeline.refetch()} />
            ) : timeline.data.length === 0 ? (
              <p className="text-sm text-muted">No events recorded yet. They appear here within a few seconds.</p>
            ) : (
              <ActivityFeed entries={timeline.data} />
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function ActionPanel({ r, blocker, approverView }: { r: ApprovalRequest; blocker: string | null; approverView: boolean }) {
  const { user } = useAuth();
  const pending = usePending(r.id);
  const final = FINAL_STATUSES.includes(r.status);
  const cancellable = canCancel(r, user);
  const step = currentStep(r);

  if (final && !pending) {
    const m = statusMeta[r.status];
    return (
      <Panel title="Outcome">
        <p className="text-sm text-ink-2">{m.hint}</p>
        {r.completed_at && <p className="mt-1 text-[13px] text-muted">Closed {dateTime(r.completed_at)}.</p>}
      </Panel>
    );
  }

  return (
    <Panel title={blocker === null ? 'Your decision' : 'What happens next'}>
      <div className="space-y-4">
        {step && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            Waiting on <RoleBadge role={step.assigned_role} />
            {step.assigned_role !== step.role && <span className="text-[13px] text-esc">escalated from {roleLabel(step.role)}</span>}
          </div>
        )}
        {blocker === null ? (
          <>
            <p className="text-sm text-muted">Approve to send it on, or reject with a reason. Your name and comment are recorded in the audit log.</p>
            <DecisionControls request={r} stretch />
          </>
        ) : pending ? (
          <p className="flex items-center gap-2 text-sm text-warn" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Processing your {pending.kind === 'CANCEL' ? 'cancellation' : pending.kind === 'APPROVE' ? 'approval' : 'rejection'}…
          </p>
        ) : (
          (approverView || r.status === 'SUBMITTED') && <p className="text-sm text-muted">{blocker}</p>
        )}
        {!approverView && !cancellable && r.status !== 'SUBMITTED' && <p className="text-sm text-muted">You'll see each decision here as it happens.</p>}
        {cancellable && !pending && <CancelButton r={r} />}
      </div>
    </Panel>
  );
}

function CancelButton({ r }: { r: ApprovalRequest }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancel(r.id);
      trackTransition(qc, r, 'CANCEL');
      toast('Cancellation sent', { description: 'Withdrawing the request now.' });
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t border-line pt-4">
      <p className="mb-2.5 text-[13px] text-muted">Changed your mind? You can withdraw it until the final decision.</p>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} icon={<Undo2 className="size-4" aria-hidden />}>
        Cancel request
      </Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        size="sm"
        title="Cancel this request?"
        description={`“${r.title}” will be withdrawn and approvers won't see it any more. This can't be undone.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Keep request
            </Button>
            <Button variant="danger" onClick={confirm} loading={busy}>
              Cancel request
            </Button>
          </>
        }
      >
        {error ? <InlineError>{error}</InlineError> : <p className="text-sm text-ink-2">Anyone who already approved it will see it as cancelled.</p>}
      </Dialog>
    </div>
  );
}
