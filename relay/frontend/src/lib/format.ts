import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

const inrFormatters = new Map<string, Intl.NumberFormat>();

export function money(amount: number | null | undefined, currency = 'INR', opts: { compact?: boolean } = {}) {
  if (amount == null || Number.isNaN(amount)) return '—';
  const whole = Number.isInteger(amount);
  const key = `${currency}:${opts.compact ? 'c' : whole ? 'i' : 'd'}`;
  let f = inrFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: opts.compact ? 1 : 2,
      minimumFractionDigits: opts.compact || whole ? 0 : 2,
      notation: opts.compact ? 'compact' : 'standard',
    });
    inrFormatters.set(key, f);
  }
  return f.format(amount);
}

/** Indian digit grouping for the amount input (1,00,000). */
export function groupDigits(raw: string) {
  const [int, dec] = raw.split('.');
  const n = int.replace(/\D/g, '');
  if (!n) return dec !== undefined ? `0.${dec}` : '';
  const grouped = Number(n).toLocaleString('en-IN');
  return dec !== undefined ? `${grouped}.${dec.replace(/\D/g, '').slice(0, 2)}` : grouped;
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  // Treat naive timestamps from the API as UTC.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
  const d = parseISO(iso);
  return isValid(d) ? d : null;
}

export function dateTime(value: string | null | undefined) {
  const d = parseDate(value);
  return d ? format(d, 'd MMM yyyy, HH:mm') : '—';
}

export function dateTimeSeconds(value: string | null | undefined) {
  const d = parseDate(value);
  return d ? format(d, 'd MMM yyyy, HH:mm:ss') : '—';
}

export function shortDate(value: string | null | undefined) {
  const d = parseDate(value);
  return d ? format(d, 'd MMM') : '—';
}

export function relative(value: string | null | undefined) {
  const d = parseDate(value);
  if (!d) return '—';
  if (Math.abs(Date.now() - d.getTime()) < 45_000) return 'just now';
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** Compact duration: 2d 4h, 3h 12m, 4m 10s, 35s. */
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** SLA hours are floats (0.01h for demos). Human label: "24h", "90m", "36s". */
export function slaLabel(hours: number) {
  if (hours >= 1) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  const minutes = hours * 60;
  if (minutes >= 1) return `${Math.round(minutes)}m`;
  return `${Math.round(minutes * 60)}s`;
}

export function hoursLabel(hours: number | null | undefined) {
  if (hours == null) return '—';
  if (hours * 60 < 1) return `${Math.max(1, Math.round(hours * 3600))} s`;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
}
