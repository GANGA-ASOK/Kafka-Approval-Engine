import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium whitespace-nowrap select-none transition-colors duration-150 disabled:opacity-55 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover shadow-[var(--shadow-card)]',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-raised hover:border-faint',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  danger: 'bg-bad text-white hover:brightness-95 dark:text-canvas',
  success: 'bg-ok text-white hover:brightness-95 dark:text-canvas',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return cn(base, variants[variant], sizes[size], extra);
}

export const controlClass =
  'w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint shadow-[inset_0_1px_0_rgb(23_32_54/0.03)] transition-colors hover:border-faint focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20 disabled:bg-sunken disabled:text-muted aria-[invalid=true]:border-bad aria-[invalid=true]:focus:ring-bad/20';
