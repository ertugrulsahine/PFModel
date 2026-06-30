import { bullet, sculpted, straightLine, sum } from './finance';
import { DebtSchedule, FundingInstrument, InstrumentType, Period, ProjectModel } from './types';
import { monthsPerPeriod } from './timeline';

export const debtInstrumentTypes = new Set<InstrumentType>(['Senior debt', 'Mezzanine debt', 'Bridge loan', 'ECA facility', 'IFI / DFI facility', 'Working capital facility', 'Refinancing debt', 'Shareholder loan']);
export const isDebtLike = (i: FundingInstrument) => debtInstrumentTypes.has(i.type);
export const annualRate = (i: FundingInstrument, shock = 0) => Math.max(0, (i.interestType === 'fixed' ? i.fixedRate : i.baseRate + i.margin) + shock);
export const periodRate = (i: FundingInstrument, months: number, shock = 0) => annualRate(i, shock) * months / 12;
const capFloor = (value: number, floor = 0, cap = Number.POSITIVE_INFINITY) => Math.max(floor, Math.min(cap, value));

export function activeDebtInstruments(project: ProjectModel) {
  return project.instruments.filter(i => i.enabled && isDebtLike(i) && i.availableDuringConstruction !== false).sort((a, b) => a.fundingPriority - b.fundingPriority);
}

export function debtShareTotal(project: ProjectModel) {
  return activeDebtInstruments(project).filter(i => (i.fundingMethod ?? '% of total debt') === '% of total debt').reduce((a, i) => a + (i.fundingPercentage ?? 0), 0);
}

export function allocateDebt(project: ProjectModel, totalUses: number) {
  const targetDebt = Math.max(0, totalUses * project.funding.targetGearing);
  const instruments = activeDebtInstruments(project).filter(i => i.includeInDebtSizing !== false);
  const allocation: Record<string, number> = {};
  let fixedDebt = 0;
  instruments.filter(i => (i.fundingMethod ?? 'Fixed amount') === 'Fixed amount').forEach(i => {
    const amount = capFloor(i.commitment, i.fundingFloor ?? 0, i.fundingCap ?? i.commitment);
    allocation[i.id] = amount;
    fixedDebt += amount;
  });
  let remainingDebt = Math.max(0, targetDebt - fixedDebt);
  const pctDebt = instruments.filter(i => (i.fundingMethod ?? '% of total debt') === '% of total debt');
  const shareTotal = pctDebt.reduce((a, i) => a + (i.fundingPercentage ?? 0), 0);
  pctDebt.forEach(i => {
    const share = shareTotal > 0 ? (i.fundingPercentage ?? 0) / shareTotal : 0;
    allocation[i.id] = capFloor(remainingDebt * share, i.fundingFloor ?? 0, i.fundingCap ?? Number.POSITIVE_INFINITY);
  });
  const pctUses = instruments.filter(i => i.fundingMethod === '% of total uses');
  pctUses.forEach(i => { allocation[i.id] = capFloor(totalUses * (i.fundingPercentage ?? 0), i.fundingFloor ?? 0, i.fundingCap ?? Number.POSITIVE_INFINITY); });
  let allocated = sum(Object.values(allocation));
  let residual = Math.max(0, targetDebt - allocated);
  instruments.filter(i => i.fundingMethod === 'Residual debt').forEach(i => {
    const amount = capFloor(residual, i.fundingFloor ?? 0, i.fundingCap ?? Number.POSITIVE_INFINITY);
    allocation[i.id] = (allocation[i.id] ?? 0) + amount;
    residual = Math.max(0, residual - amount);
  });
  allocated = sum(Object.values(allocation));
  if (!project.funding.allowDebtAboveTarget && allocated > targetDebt) {
    const scale = targetDebt / allocated;
    Object.keys(allocation).forEach(id => { allocation[id] *= scale; });
  }
  return { targetDebt, allocation };
}

function repaymentProfile(inst: FundingInstrument, cfads: number[], openingDebt: number, rate: number) {
  const n = cfads.length;
  if (openingDebt <= 0 || n <= 0) return [];
  if (inst.repaymentType === 'Bullet') return bullet(openingDebt, n);
  if (inst.repaymentType === 'Sculpted repayment') return sculpted(cfads, inst.targetDSCR || 1.3, openingDebt, rate);
  if (inst.repaymentType === 'Cash sweep') return cfads.map((c, i) => i < n - 1 ? Math.max(0, c * 0.5) : openingDebt).map(x => Math.min(x, openingDebt));
  return straightLine(openingDebt, n);
}

export function buildDebtSchedules(project: ProjectModel, periods: Period[], cfadsBeforeDebt: number[], debtAllocation: Record<string, number>) {
  const months = monthsPerPeriod(project.timeline.frequency);
  const scenario = project.scenarios.find(s => s.id === project.activeScenarioId) ?? project.scenarios[0];
  const constructionCount = periods.filter(p => p.phase === 'construction').length || 1;
  const operationIndexes = periods.map((p, i) => p.phase === 'operation' ? i : -1).filter(i => i >= 0);
  const debts = activeDebtInstruments(project);
  return debts.map((inst) => {
    const initialDebt = debtAllocation[inst.id] ?? 0;
    const drawdown = periods.map((p) => p.phase === 'construction' ? initialDebt / constructionCount : 0);
    const fees = periods.map((p) => p.phase === 'construction' ? initialDebt * (inst.upfrontFee + inst.arrangementFee + inst.commitmentFee + inst.undrawnFee) / constructionCount + inst.agencyFee / constructionCount : 0);
    const openingBalance = periods.map(() => 0);
    const interest = periods.map(() => 0);
    const capitalizedInterest = periods.map(() => 0);
    const principal = periods.map(() => 0);
    const cashSweep = periods.map(() => 0);
    const closingBalance = periods.map(() => 0);
    let balance = 0;
    const opCfadsForDebt = operationIndexes.map(i => Math.max(0, cfadsBeforeDebt[i] / Math.max(1, debts.length)));
    const profile = repaymentProfile(inst, opCfadsForDebt, initialDebt, periodRate(inst, months, scenario?.rateShock ?? 0));
    periods.forEach((p, idx) => {
      openingBalance[idx] = balance;
      balance += drawdown[idx];
      interest[idx] = balance * periodRate(inst, months, scenario?.rateShock ?? 0);
      if (p.phase === 'construction' && inst.capitalizedInterest) {
        capitalizedInterest[idx] = interest[idx];
        balance += capitalizedInterest[idx];
      }
      if (p.phase === 'construction' && inst.debtFundedFees) balance += fees[idx];
      if (p.phase === 'operation') {
        const opPos = operationIndexes.indexOf(idx);
        principal[idx] = Math.min(balance, profile[opPos] ?? 0);
        const excess = inst.cashSweep ? Math.max(0, opCfadsForDebt[opPos] - interest[idx] - principal[idx]) * 0.25 : 0;
        cashSweep[idx] = Math.min(Math.max(0, balance - principal[idx]), excess);
        balance = Math.max(0, balance - principal[idx] - cashSweep[idx]);
      }
      closingBalance[idx] = balance;
    });
    return { instrumentId: inst.id, name: inst.name, type: inst.type, seniority: inst.seniority, openingBalance, drawdown, interest, capitalizedInterest, fees, principal, cashSweep, closingBalance } satisfies DebtSchedule;
  });
}
