import { Frequency, Period, TimelineAssumptions } from './types';
import { periodLabel } from './format';

const monthsByFreq: Record<Frequency, number> = { monthly: 1, quarterly: 3, 'semi-annual': 6, annual: 12 };

export const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

export const daysBefore = (a: string, b: string) => new Date(`${a}T00:00:00Z`) < new Date(`${b}T00:00:00Z`);

export function periodsPerYear(f: Frequency) { return 12 / monthsByFreq[f]; }
export function monthsPerPeriod(f: Frequency) { return monthsByFreq[f]; }

export function generateTimeline(t: TimelineAssumptions): Period[] {
  const step = monthsByFreq[t.frequency];
  const out: Period[] = [];
  let start = t.projectStart;
  let i = 0;
  while (new Date(`${start}T00:00:00Z`) < new Date(`${t.operationEnd}T00:00:00Z`)) {
    const next = addMonths(start, step);
    const end = daysBefore(next, t.operationEnd) ? next : t.operationEnd;
    const phase = daysBefore(start, t.cod) ? 'construction' : 'operation';
    const d = new Date(`${start}T00:00:00Z`);
    out.push({
      index: i,
      label: periodLabel(start, t.frequency),
      start,
      end,
      phase,
      year: d.getUTCFullYear(),
      type: t.frequency,
    });
    start = next;
    i += 1;
    if (i > 600) throw new Error('Timeline exceeds 600 periods');
  }
  return out;
}
