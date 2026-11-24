import { cn } from '../../lib/cn';

interface Option<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Radio-group styled as a segmented control (keyboard: arrow keys via native radios). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: Option<T>[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full overflow-x-auto rounded-[var(--radius-control)] border border-line bg-sunken p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              'relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
              active ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink',
            )}
          >
            <input type="radio" className="sr-only" name={label} value={o.value} checked={active} onChange={() => onChange(o.value)} />
            {o.label}
            {o.count != null && <span className={cn('tnum rounded-full px-1.5 text-[11px]', active ? 'bg-accent-soft text-accent-ink' : 'bg-line text-muted')}>{o.count}</span>}
          </label>
        );
      })}
    </div>
  );
}
