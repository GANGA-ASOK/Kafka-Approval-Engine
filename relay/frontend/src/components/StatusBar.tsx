import { cn } from '../lib/cn';
import { statusMeta, toneClasses } from '../lib/labels';
import type { RequestStatus } from '../lib/types';
import { REQUEST_STATUSES } from '../lib/types';

/** Single stacked bar of requests by status with a legend that doubles as the data table. */
export function StatusBar({ byStatus }: { byStatus: Partial<Record<RequestStatus, number>> }) {
  const rows = REQUEST_STATUSES.map((s) => ({ status: s, n: byStatus[s] ?? 0 }));
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (total === 0) return <p className="text-sm text-muted">No requests yet.</p>;
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={rows.filter((r) => r.n).map((r) => `${statusMeta[r.status].label}: ${r.n}`).join(', ')}>
        {rows
          .filter((r) => r.n > 0)
          .map((r) => (
            <span
              key={r.status}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', toneClasses[statusMeta[r.status].tone].bar, r.status === 'SUBMITTED' && 'opacity-60')}
              style={{ flexGrow: r.n, flexBasis: 0, minWidth: 4 }}
              title={`${statusMeta[r.status].label}: ${r.n} (${Math.round((r.n / total) * 100)}%)`}
            />
          ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
        {rows.map((r) => (
          <div key={r.status} className="flex items-center gap-2 text-[13px]">
            <span className={cn('size-2.5 shrink-0 rounded-sm', toneClasses[statusMeta[r.status].tone].bar, r.status === 'SUBMITTED' && 'opacity-60')} aria-hidden />
            <dt className="flex-1 text-muted">{statusMeta[r.status].label}</dt>
            <dd className="tnum font-semibold text-ink">{r.n}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
