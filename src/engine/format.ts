import { Frequency, Period } from './types';

const invalid = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value);

export function formatMoney(value: number | null | undefined, compact = false): string {
  if (invalid(value)) return '—';
  const n = value as number;
  const sign = n < 0;
  const abs = Math.abs(n);
  const body = compact && abs >= 1_000_000
    ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`
    : abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return sign ? `(${body})` : body;
}

export function formatPercent(value: number | null | undefined): string {
  if (invalid(value)) return '—';
  return `${((value as number) * 100).toFixed(1)}%`;
}

export function formatRatio(value: number | null | undefined): string {
  if (invalid(value)) return '—';
  return `${(value as number).toFixed(2)}x`;
}

export function formatBps(value: number | null | undefined): string {
  if (invalid(value)) return '—';
  return `${Math.round((value as number) * 10_000).toLocaleString()} bps`;
}

const month = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });

export function formatDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return `${month.format(d)} ${d.getUTCFullYear()}`;
}

export function periodLabel(start: string, frequency: Frequency): string {
  const d = new Date(`${start}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (frequency === 'annual') return `FY${y}`;
  if (frequency === 'semi-annual') return `${m < 6 ? 'H1' : 'H2'} ${y}`;
  if (frequency === 'quarterly') return `Q${Math.floor(m / 3) + 1} ${y}`;
  return `${month.format(d)} ${y}`;
}

export function displayPeriod(period: Period): string {
  return period.label;
}
