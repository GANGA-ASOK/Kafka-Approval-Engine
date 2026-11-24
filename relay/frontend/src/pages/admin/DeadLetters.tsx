import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, PartyPopper, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { dateTimeSeconds, relative } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { eventLabel } from '../../lib/labels';
import { useDeadLetters } from '../../lib/queries';
import type { DeadLetter, DeadLetterStatus } from '../../lib/types';
import { Badge } from '../../components/Badges';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback';
import { PageHeader } from '../../components/ui/Panel';
import { Segmented } from '../../components/ui/Segmented';
import { JsonView } from '../../components/JsonView';

type Filter = DeadLetterStatus | 'ALL';
type Action = { kind: 'replay' | 'discard'; item: DeadLetter } | null;

const statusTone = { PENDING: 'warn', REPLAYED: 'ok', DISCARDED: 'neutral' } as const;
const statusText = { PENDING: 'Needs attention', REPLAYED: 'Replayed', DISCARDED: 'Discarded' } as const;

export default function DeadLetters() {
  useDocumentTitle('Failed events');
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('PENDING');
  const dlq = useDeadLetters(filter);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!action) return;
    setBusy(true);
    try {
      if (action.kind === 'replay') await api.replayDeadLetter(action.item.id);
      else await api.discardDeadLetter(action.item.id);
      toast.success(action.kind === 'replay' ? 'Event replayed' : 'Event discarded', {
        description: action.kind === 'replay' ? 'It was sent back to the workflow engine with a new event ID.' : 'It stays here for the record but will not be processed.',
      });
      qc.invalidateQueries({ queryKey: ['dlq'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
      if (action.item.event.request_id) qc.invalidateQueries({ queryKey: ['request', action.item.event.request_id] });
      setAction(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Failed events"
        description="Events that still failed after every automatic retry. Fix the cause, then replay them, or discard ones that should never run."
      />
      <div className="mb-4">
        <Segmented
          label="Filter by status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'PENDING', label: 'Needs attention' },
            { value: 'REPLAYED', label: 'Replayed' },
            { value: 'DISCARDED', label: 'Discarded' },
            { value: 'ALL', label: 'All' },
          ]}
        />
      </div>
      <section aria-label="Failed events" className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
        {dlq.isPending ? (
          <SkeletonRows rows={4} />
        ) : dlq.isError ? (
          <ErrorState error={dlq.error} onRetry={() => dlq.refetch()} />
        ) : dlq.data.length === 0 ? (
          <EmptyState icon={<PartyPopper className="size-5" />} title={filter === 'PENDING' ? 'Nothing is stuck' : 'No events here'}>
            {filter === 'PENDING' ? (
              <>
                Every event was processed. To see this screen in action, submit a request with <code className="rounded bg-sunken px-1 font-mono text-[12.5px]">[fail]</code> in its title: it fails, retries, then lands here.
              </>
            ) : (
              'Events you replay or discard are listed here.'
            )}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line bg-raised text-[12.5px] text-muted">
                <tr>
                  <th scope="col" className="w-10 py-2.5 pl-4">
                    <span className="sr-only">Expand</span>
                  </th>
                  <th scope="col" className="py-2.5 pr-4 font-medium">Event</th>
                  <th scope="col" className="py-2.5 pr-4 font-medium">Error</th>
                  <th scope="col" className="py-2.5 pr-4 font-medium">Attempts</th>
                  <th scope="col" className="py-2.5 pr-4 font-medium">Failed</th>
                  <th scope="col" className="py-2.5 pr-5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dlq.data.map((d) => {
                  const isOpen = open.has(d.id);
                  return (
                    <Fragment key={d.id}>
                      <tr className={cn('align-top', isOpen && 'bg-raised')}>
                        <td className="py-3 pl-4">
                          <button type="button" onClick={() => toggle(d.id)} aria-expanded={isOpen} aria-label={isOpen ? 'Hide event' : 'Show event'} className="grid size-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink">
                            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                        </td>
                        <td className="py-3 pr-4">
                          <p className="font-semibold text-ink">{eventLabel(d.event.event_type ?? 'UNKNOWN')}</p>
                          {d.event.request_id && (
                            <Link to={`/requests/${d.event.request_id}`} className="font-mono text-[12.5px] text-accent hover:underline">
                              {d.event.request_id}
                            </Link>
                          )}
                          <p className="text-[12px] text-faint">Consumer: {d.group}</p>
                        </td>
                        <td className="max-w-sm py-3 pr-4">
                          <p className="line-clamp-2 font-mono text-[12.5px] text-bad" title={d.error}>
                            {d.error}
                          </p>
                        </td>
                        <td className="tnum py-3 pr-4 text-ink-2">{d.attempts}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          <time dateTime={d.failed_at} title={dateTimeSeconds(d.failed_at)} className="text-muted">
                            {relative(d.failed_at)}
                          </time>
                        </td>
                        <td className="py-3 pr-5 text-right">
                          {d.status === 'PENDING' ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="primary" onClick={() => setAction({ kind: 'replay', item: d })} icon={<RotateCcw className="size-3.5" aria-hidden />}>
                                Replay
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'discard', item: d })} icon={<Trash2 className="size-3.5" aria-hidden />}>
                                Discard
                              </Button>
                            </div>
                          ) : (
                            <Badge tone={statusTone[d.status]}>{statusText[d.status]}</Badge>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-raised">
                          <td />
                          <td colSpan={5} className="pr-5 pb-4">
                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="rounded-lg border border-line bg-surface p-3">
                                <p className="text-[12px] font-medium text-muted">Full error</p>
                                <pre className="mt-1 max-h-60 overflow-auto font-mono text-[12px] whitespace-pre-wrap text-bad">{d.error}</pre>
                              </div>
                              <JsonView value={d.event} label="Original event" />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={action !== null}
        onClose={() => !busy && setAction(null)}
        size="sm"
        title={action?.kind === 'replay' ? 'Replay this event?' : 'Discard this event?'}
        description={
          action?.kind === 'replay'
            ? `“${eventLabel(action.item.event.event_type ?? '')}” is sent to the workflow engine again with a new event ID. Duplicate protection means it can't apply twice.`
            : 'It will never be processed. The request it belongs to may stay stuck until handled another way.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)} disabled={busy}>
              Not now
            </Button>
            <Button variant={action?.kind === 'replay' ? 'primary' : 'danger'} loading={busy} onClick={run}>
              {action?.kind === 'replay' ? 'Replay event' : 'Discard event'}
            </Button>
          </>
        }
      >
        {action && (
          <p className="text-sm text-ink-2">
            Failed {action.item.attempts} {action.item.attempts === 1 ? 'time' : 'times'} with: <span className="font-mono text-[12.5px] text-bad">{action.item.error}</span>
          </p>
        )}
      </Dialog>
    </>
  );
}
