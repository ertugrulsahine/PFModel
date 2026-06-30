import { bullet, sculpted, straightLine, sum } from './finance';
import { DebtSchedule, FundingInstrument, InstrumentType, Period, ProjectModel } from './types';
import { monthsPerPeriod } from './timeline';

export const debtInstrumentTypes = new Set<InstrumentType>(['Senior debt', 'Mezzanine debt', 'Bridge loan', 'ECA facility', 'IFI / DFI facility', 'VAT facility', 'Working capital facility', 'Refinancing debt', 'Shareholder loan']);
export const isDebtLike = (i: FundingInstrument) => debtInstrumentTypes.has(i.type);
export const annualRate = (i: FundingInstrument, shock = 0) => Math.max(0, (i.interestType === 'fixed' ? i.fixedRate : i.baseRate + i.margin) + shock);
export const periodRate = (i: FundingInstrument, months: number, shock = 0) => annualRate(i, shock) * months / 12;

export function debtCapacityByInstrument(inst: FundingInstrument, totalUses: number, cfads: number[], months: number, shock: number) {
  const rate = periodRate(inst, months, shock);
  if (inst.type === 'VAT facility' || inst.type === 'Working capital facility') return Math.min(inst.commitment, totalUses * 0.05);
  if (inst.sizingMethod.includes('DSCR')) return Math.min(inst.commitment, cfads.reduce((pv, c, i) => pv + Math.max(0, c / (inst.targetDSCR || 1.3)) / Math.pow(1 + rate, i + 1), 0));
  if (inst.sizingMethod.includes('Gearing')) return Math.min(inst.commitment, totalUses * (inst.maxGearing || 0.65));
  if (inst.sizingMethod.includes('capital')) return Math.min(inst.commitment, totalUses * (inst.maxGearing || 0.65));
  return inst.commitment;
}

function repaymentProfile(inst: FundingInstrument, cfads: number[], openingDebt: number, rate: number) {
  const n = cfads.length;
  if (openingDebt <= 0 || n <= 0) return [];
  if (inst.repaymentType === 'Bullet') return bullet(openingDebt, n);
  if (inst.repaymentType === 'Sculpted repayment') return sculpted(cfads, inst.targetDSCR || 1.3, openingDebt, rate);
  if (inst.repaymentType === 'Cash sweep') return cfads.map((c, i) => i < n - 1 ? Math.max(0, c * 0.5) : openingDebt).map(x => Math.min(x, openingDebt));
  return straightLine(openingDebt, n);
}

export function buildDebtSchedules(project: ProjectModel, periods: Period[], cfadsBeforeDebt: number[], constructionDraw: number[], dsraFundingNeed: number) {
  const months = monthsPerPeriod(project.timeline.frequency);
  const scenario = project.scenarios.find(s => s.id === project.activeScenarioId) ?? project.scenarios[0];
  const constructionCount = periods.filter(p => p.phase === 'construction').length || 1;
  const operationIndexes = periods.map((p, i) => p.phase === 'operation' ? i : -1).filter(i => i >= 0);
  const totalBaseUses = sum(constructionDraw) + dsraFundingNeed;
  const debts = project.instruments.filter(i => i.enabled && isDebtLike(i)).sort((a, b) => a.fundingPriority - b.fundingPriority);
  const grantAmount = sum(project.instruments.filter(i => i.enabled && i.type === 'Grant / subsidy').map(i => i.commitment));
  let remainingFunding = Math.max(0, totalBaseUses - grantAmount);
  const schedules: DebtSchedule[] = [];
  debts.forEach((inst) => {
    const capacity = debtCapacityByInstrument(inst, totalBaseUses, operationIndexes.map(i => cfadsBeforeDebt[i]), months, scenario?.rateShock ?? 0);
    const initialDebt = Math.min(capacity, remainingFunding);
    remainingFunding -= initialDebt;
    const drawdown = periods.map((p) => p.phase === 'construction' ? initialDebt / constructionCount : 0);
    const fees = periods.map((p) => p.phase === 'construction' ? initialDebt * (inst.upfrontFee + inst.arrangementFee) / constructionCount + inst.agencyFee / Math.max(1, periods.length) : 0);
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
        cashSweep[idx] = Math.min(balance - principal[idx], excess);
        balance = Math.max(0, balance - principal[idx] - cashSweep[idx]);
      }
      closingBalance[idx] = balance;
    });
    schedules.push({ instrumentId: inst.id, name: inst.name, type: inst.type, seniority: inst.seniority, openingBalance, drawdown, interest, capitalizedInterest, fees, principal, cashSweep, closingBalance });
  });
  return schedules;
}
