import type { ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/api';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-shimmer rounded-md bg-sunken', className)} />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-line', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

interface EmptyProps {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, children, action, compact }: EmptyProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-6 py-8' : 'px-6 py-14')}>
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-full bg-sunken text-muted">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Couldn't load this", compact }: { error: unknown; onRetry?: () => void; title?: string; compact?: boolean }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center text-center', compact ? 'px-6 py-8' : 'px-6 py-14')}>
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-bad-soft text-bad">
        <AlertCircle className="size-5" aria-hidden />
      </div>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry} icon={<RefreshCw className="size-3.5" aria-hidden />}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-bad/25 bg-bad-soft px-3 py-2.5 text-sm text-bad">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
