import { cn } from '../lib/cn';
import { initials } from '../lib/format';
import { roleMeta } from '../lib/labels';
import type { Role } from '../lib/types';

export function Avatar({ name, role, className }: { name: string | null | undefined; role?: Role | string | null; className?: string }) {
  const m = role ? roleMeta[role as Role] : undefined;
  return (
    <span
      className={cn('grid size-8 shrink-0 place-items-center rounded-full border-2 bg-raised text-[11.5px] font-semibold text-ink-2', m?.border ?? 'border-line-strong', className)}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
