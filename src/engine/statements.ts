import { sum } from './finance';
import { DebtSchedule, Period } from './types';

export function buildStatements(input: {
  periods: Period[]; revenue: number[]; operatingCosts: number[]; ebitda: number[]; depreciation: number[]; interest: number[]; tax: number[]; maintenance: number[]; wc: number[]; constructionDraw: number[]; capitalizedFinancingCosts: number[]; debtSchedules: DebtSchedule[]; dsra: number[]; distributions: number[]; closingCash: number[]; equityContrib: number[]; grants: number[];
}) {
  const { periods, revenue, operatingCosts, ebitda, depreciation, interest, tax, maintenance, wc, constructionDraw, capitalizedFinancingCosts, debtSchedules, dsra, distributions, closingCash, equityContrib, grants } = input;
  const ebit = ebitda.map((x, i) => x - depreciation[i]);
  const pbt = ebit.map((x, i) => x - interest[i]);
  const netIncome = pbt.map((x, i) => x - tax[i]);
  const accumulatedDep = periods.map((_, i) => sum(depreciation.slice(0, i + 1)));
  const grossFixedAssets = periods.map((_, i) => sum(constructionDraw.slice(0, i + 1)) + sum(capitalizedFinancingCosts.slice(0, i + 1)));
  const financingCostAsset = periods.map((_, i) => sum(capitalizedFinancingCosts.slice(0, i + 1)));
  const netFixedAssets = grossFixedAssets.map((x, i) => x - accumulatedDep[i]);
  const retainedEarnings: number[] = [];
  let re = 0;
  netIncome.forEach((n, i) => { re += n - distributions[i]; retainedEarnings[i] = re; });
  const seniorDebt = periods.map((_, i) => sum(debtSchedules.filter(d => d.seniority === 'senior').map(d => d.closingBalance[i])));
  const mezzDebt = periods.map((_, i) => sum(debtSchedules.filter(d => d.seniority === 'mezzanine').map(d => d.closingBalance[i])));
  const shlDebt = periods.map((_, i) => sum(debtSchedules.filter(d => d.type === 'Shareholder loan').map(d => d.closingBalance[i])));
  const otherDebt = periods.map((_, i) => sum(debtSchedules.filter(d => !['senior', 'mezzanine'].includes(d.seniority) && d.type !== 'Shareholder loan').map(d => d.closingBalance[i])));
  const equity = periods.map((_, i) => sum(equityContrib.slice(0, i + 1)));
  const grantReserve = periods.map((_, i) => sum(grants.slice(0, i + 1)));
  const balanceCheck = periods.map((_, i) => netFixedAssets[i] + closingCash[i] + dsra[i] - (seniorDebt[i] + mezzDebt[i] + shlDebt[i] + otherDebt[i] + equity[i] + grantReserve[i] + retainedEarnings[i]));
  const incomeStatement = { Revenue: revenue, 'Operating costs': operatingCosts, EBITDA: ebitda, Depreciation: depreciation, EBIT: ebit, 'Interest expense': interest, 'Profit before tax': pbt, Tax: tax, 'Net income': netIncome };
  const cashFlowStatement = {
    'Cash flow from operations': ebitda.map((x, i) => x - tax[i] - maintenance[i] - wc[i]),
    'Cash flow from investing': constructionDraw.map(x => -x),
    'Cash flow from financing': periods.map((_, i) => sum(debtSchedules.map(d => d.drawdown[i] - d.principal[i] - d.cashSweep[i])) + equityContrib[i] + grants[i] - distributions[i]),
    'Net change in cash': closingCash.map((c, i) => c - (closingCash[i - 1] ?? 0)),
    'Opening cash': closingCash.map((_, i) => closingCash[i - 1] ?? 0),
    'Closing cash': closingCash,
    'Cash check': closingCash.map((c, i) => c - ((closingCash[i - 1] ?? 0) + (ebitda[i] - tax[i] - maintenance[i] - wc[i]) - constructionDraw[i] + sum(debtSchedules.map(d => d.drawdown[i] - d.principal[i] - d.cashSweep[i])) + equityContrib[i] + grants[i] - distributions[i])),
  };
  const balanceSheet = { 'Gross fixed assets': grossFixedAssets, 'Capitalized financing costs': financingCostAsset, 'Accumulated depreciation': accumulatedDep.map(x => -x), 'Net fixed assets': netFixedAssets, Cash: closingCash, DSRA: dsra, 'Other reserves': periods.map(() => 0), 'Senior debt': seniorDebt, 'Mezzanine debt': mezzDebt, 'Shareholder loan': shlDebt, 'Other debt': otherDebt, Equity: equity, 'Grant reserve': grantReserve, 'Retained earnings': retainedEarnings, 'Balance check': balanceCheck };
  return { incomeStatement, cashFlowStatement, balanceSheet, balanceCheck, netIncome };
}
