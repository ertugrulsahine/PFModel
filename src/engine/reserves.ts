import { ReserveSchedule, ProjectModel } from './types';
import { monthsPerPeriod } from './timeline';
import { sum } from './finance';

export function buildDsra(project: ProjectModel, debtService: number[], lcCommitment: number): ReserveSchedule {
  const reserve = project.reserves.find(r => r.type === 'DSRA');
  const months = reserve?.months ?? 6;
  const lookAhead = reserve?.method.includes('12') ? Math.round(12 / monthsPerPeriod(project.timeline.frequency)) : Math.max(1, Math.round(months / monthsPerPeriod(project.timeline.frequency)));
  const target = debtService.map((_, i) => reserve?.fixedAmount ? reserve.fixedAmount : sum(debtService.slice(i + 1, i + 1 + lookAhead)));
  const openingBalance = debtService.map(() => 0);
  const topUp = debtService.map(() => 0);
  const release = debtService.map(() => 0);
  const closingBalance = debtService.map(() => 0);
  const lcSupport = target.map(t => reserve?.funding === 'LC-backed' ? Math.min(t, lcCommitment) : 0);
  let cashBalance = 0;
  target.forEach((t, i) => {
    openingBalance[i] = cashBalance;
    const cashTarget = Math.max(0, t - lcSupport[i]);
    if (cashBalance < cashTarget) topUp[i] = cashTarget - cashBalance;
    if (cashBalance > cashTarget) release[i] = cashBalance - cashTarget;
    cashBalance += topUp[i] - release[i];
    closingBalance[i] = cashBalance;
  });
  return { target, openingBalance, topUp, release, lcSupport, closingBalance };
}
