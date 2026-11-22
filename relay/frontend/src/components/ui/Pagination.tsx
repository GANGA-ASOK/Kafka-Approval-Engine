import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

interface Props {
  total: number;
  limit: number;
  skip: number;
  onChange: (skip: number) => void;
  noun?: string;
}

export function Pagination({ total, limit, skip, onChange, noun = 'items' }: Props) {
  if (total === 0) return null;
  const from = skip + 1;
  const to = Math.min(skip + limit, total);
  const page = Math.floor(skip / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px] text-muted">
      <span className="tnum">
        Showing <strong className="font-semibold text-ink">{from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}</strong> of{' '}
        {total.toLocaleString('en-IN')} {noun}
      </span>
      <div className="flex items-center gap-2">
        <span className="tnum hidden sm:inline">
          Page {page} of {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={skip === 0} onClick={() => onChange(Math.max(0, skip - limit))} icon={<ChevronLeft className="size-4" aria-hidden />}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={to >= total} onClick={() => onChange(skip + limit)}>
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
