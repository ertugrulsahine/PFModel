import { buildConstructionFunding } from './construction';
import { buildCovenants } from './covenants';
import { buildDebtSchedules } from './debt';
import { bullet, dscr, irr, sculpted, sizeByDSCR, sizeByGearing, straightLine, sum } from './finance';
import { buildOperatingModel } from './operating';
import { buildDsra } from './reserves';
import { buildStatements } from './statements';
import { generateTimeline } from './timeline';
import { ModelResults, ProjectModel, SolverLogEntry } from './types';
import { validateProject } from './validation';

export { validateProject } from './validation';
export { bullet, dscr, sculpted, sizeByDSCR, sizeByGearing, straightLine } from './finance';

export function calculateModel(project: ProjectModel): ModelResults {
  const audit: string[] = [];
  const periods = generateTimeline(project.timeline);
  audit.push(`Generated ${periods.length} ${project.timeline.frequency} periods.`);
  const validation = validateProject(project);
  const operating = buildOperatingModel(project, periods);
  const construction = buildConstructionFunding(project, periods);
  const lcCommitment = sum(project.instruments.filter(i => i.enabled && i.type === 'DSRA LC').map(i => i.commitment));
  const grantsTotal = sum(project.instruments.filter(i => i.enabled && i.type === 'Grant / subsidy').map(i => i.commitment));
  let previousCircularDebt = 0;
  let finalDelta = Infinity;
  const log: SolverLogEntry[] = [];
  let debtSchedules = buildDebtSchedules(project, periods, operating.cfadsBeforeDebt, construction.draw, 0);
  let debtService = periods.map((_, i) => sum(debtSchedules.map(d => d.interest[i] + d.principal[i] + d.cashSweep[i])));
  let reserveSchedule = buildDsra(project, debtService, lcCommitment);

  for (let iteration = 1; iteration <= 80; iteration += 1) {
    const debtFundedDsra = project.reserves.find(r => r.type === 'DSRA')?.funding === 'debt funded' ? Math.max(...reserveSchedule.closingBalance, 0) : 0;
    debtSchedules = buildDebtSchedules(project, periods, operating.cfadsBeforeDebt, construction.draw, debtFundedDsra);
    debtService = periods.map((_, i) => sum(debtSchedules.map(d => d.interest[i] + d.principal[i] + d.cashSweep[i])));
    reserveSchedule = buildDsra(project, debtService, lcCommitment);
    const circularDebt = sum(debtSchedules.map(d => Math.max(...d.closingBalance, 0)));
    finalDelta = Math.abs(circularDebt - previousCircularDebt);
    log.push({ iteration, variable: 'IDC / fees / DSRA / sculpted repayment', previous: previousCircularDebt, next: circularDebt, delta: finalDelta, note: finalDelta < 1 ? 'converged' : 'recalculate circular debt-funded uses' });
    if (finalDelta < 1) break;
    previousCircularDebt = previousCircularDebt * 0.35 + circularDebt * 0.65;
  }

  const failed = finalDelta >= 1;
  const interest = periods.map((_, i) => sum(debtSchedules.map(d => d.interest[i])));
  const principal = periods.map((_, i) => sum(debtSchedules.map(d => d.principal[i] + d.cashSweep[i])));
  const fees = periods.map((_, i) => sum(debtSchedules.map(d => d.fees[i])));
  const idc = periods.map((p, i) => p.phase === 'construction' ? sum(debtSchedules.map(d => d.capitalizedInterest[i])) : 0);
  const debtDraws = periods.map((_, i) => sum(debtSchedules.map(d => d.drawdown[i])));
  const closingDebt = periods.map((_, i) => sum(debtSchedules.map(d => d.closingBalance[i])));
  const cfads = operating.cfadsBeforeDebt;
  const covenants = buildCovenants(project, cfads, principal.map((p, i) => p + interest[i]), closingDebt);
  const dsra = reserveSchedule.closingBalance;
  const grantContrib = periods.map((p, i) => p.phase === 'construction' ? grantsTotal / Math.max(1, periods.filter(x => x.phase === 'construction').length) : 0);
  const totalFundingNeed = periods.map((_, i) => construction.draw[i] + fees[i] + idc[i] + reserveSchedule.topUp[i] - reserveSchedule.release[i]);
  const equityInst = project.instruments.find(i => i.enabled && i.type === 'Equity');
  const equityContrib = totalFundingNeed.map((need, i) => Math.max(0, need - debtDraws[i] - grantContrib[i]));
  if (equityInst && sum(equityContrib) > equityInst.commitment) validation.push({ severity: 'warning', message: 'Minimum equity contribution exceeds enabled equity commitment.' });

  const distributions: number[] = [];
  const closingCash: number[] = [];
  let cash = 0;
  periods.forEach((period, i) => {
    cash += cfads[i] - interest[i] - principal[i] - reserveSchedule.topUp[i] + reserveSchedule.release[i] - construction.draw[i] + debtDraws[i] + equityContrib[i] + grantContrib[i] - fees[i];
    const locked = period.phase === 'construction' || covenants.distributionLocked[i] || cash < project.covenants.minimumCash;
    distributions[i] = locked ? 0 : Math.max(0, cash - project.covenants.minimumCash);
    cash -= distributions[i];
    closingCash[i] = cash;
  });

  const statements = buildStatements({ periods, revenue: operating.revenue, operatingCosts: operating.operatingCosts, ebitda: operating.ebitda, depreciation: operating.depreciation, interest, tax: operating.tax, maintenance: operating.maintenanceCapex, wc: operating.workingCapital, constructionDraw: construction.draw, debtSchedules, dsra, distributions, closingCash, equityContrib, grants: grantContrib });
  const dscrs = dscr(cfads, principal.map((p, i) => p + interest[i]));
  const finiteDscr = dscrs.filter(Number.isFinite);
  const totalDebt = sum(debtDraws);
  const totalFees = sum(fees);
  const totalIdc = sum(idc);
  const totalUses = construction.totalCapex + totalFees + totalIdc + Math.max(...dsra, 0);
  const totalSources = totalDebt + sum(equityContrib) + sum(grantContrib);
  const balanceSheetBalanced = statements.balanceCheck.every(x => Math.abs(x) < 1.5);
  const warnings = [
    ...validation.filter(v => v.severity === 'warning').map(v => v.message),
    ...(failed ? ['Circularity solver failure.'] : []),
    ...(!balanceSheetBalanced ? ['Balance sheet not balancing.'] : []),
  ];
  const sourcesUses = [
    { source: 'Total debt drawdowns', amount: totalDebt },
    { source: 'Equity requirement', amount: sum(equityContrib) },
    { source: 'Grants / subsidies', amount: sum(grantContrib) },
    { source: 'Uses: construction capex', amount: construction.totalCapex },
    { source: 'Uses: IDC', amount: totalIdc },
    { source: 'Uses: financing fees', amount: totalFees },
    { source: 'Uses: DSRA cash balance', amount: Math.max(...dsra, 0) },
  ];
  const waterfall = {
    Revenue: operating.revenue,
    'Operating costs': operating.operatingCosts.map(x => -x),
    EBITDA: operating.ebitda,
    Tax: operating.tax.map(x => -x),
    'Maintenance capex': operating.maintenanceCapex.map(x => -x),
    'Working capital movement': operating.workingCapital.map(x => -x),
    CFADS: cfads,
    'Senior debt interest': periods.map((_, i) => -sum(debtSchedules.filter(d => d.seniority === 'senior').map(d => d.interest[i]))),
    'Senior debt principal': periods.map((_, i) => -sum(debtSchedules.filter(d => d.seniority === 'senior').map(d => d.principal[i] + d.cashSweep[i]))),
    'Senior fees': fees.map(x => -x),
    'DSRA top-up': reserveSchedule.topUp.map(x => -x),
    'Mezzanine interest': periods.map((_, i) => -sum(debtSchedules.filter(d => d.seniority === 'mezzanine').map(d => d.interest[i]))),
    'Mezzanine principal': periods.map((_, i) => -sum(debtSchedules.filter(d => d.seniority === 'mezzanine').map(d => d.principal[i] + d.cashSweep[i]))),
    'Shareholder loan interest': periods.map((_, i) => -sum(debtSchedules.filter(d => d.type === 'Shareholder loan').map(d => d.interest[i]))),
    'Shareholder loan principal': periods.map((_, i) => -sum(debtSchedules.filter(d => d.type === 'Shareholder loan').map(d => d.principal[i] + d.cashSweep[i]))),
    'Cash sweep': periods.map((_, i) => -sum(debtSchedules.map(d => d.cashSweep[i]))),
    'Reserve top-ups': reserveSchedule.topUp.map(x => -x),
    Distributions: distributions.map(x => -x),
    'Closing cash': closingCash,
  };

  return {
    periods,
    revenue: operating.revenue,
    operatingCosts: operating.operatingCosts,
    ebitda: operating.ebitda,
    cfads,
    constructionDraw: construction.draw,
    debtDraws,
    fees,
    idc,
    principal,
    interest,
    closingDebt,
    dsra,
    distributions,
    closingCash,
    dscr: dscrs,
    llcr: Math.min(...covenants.llcr.filter(Number.isFinite), Infinity),
    plcr: Math.min(...covenants.plcr.filter(Number.isFinite), Infinity),
    projectIrr: irr([-construction.totalCapex, ...cfads]),
    equityIrr: irr([-Math.max(1, sum(equityContrib)), ...distributions]),
    sourcesUses,
    incomeStatement: statements.incomeStatement,
    balanceSheet: statements.balanceSheet,
    cashFlowStatement: statements.cashFlowStatement,
    waterfall,
    debtSchedules,
    reserveSchedule,
    covenants,
    solver: { status: failed ? 'failed' : 'converged', iterations: log.length, tolerance: 1, finalDelta, variables: ['Debt-funded IDC', 'Capitalized interest', 'Debt-funded fees', 'DSRA funding', 'Sculpted repayment', 'Cash sweep', 'Restricted distributions'], bindingConstraint: project.instruments.find(i => i.enabled && i.type === 'Senior debt')?.sizingMethod, failureReason: failed ? 'Circularity not converging; review gearing, tenor, interest rates and CFADS.' : undefined, warnings, log },
    validation,
    warnings,
    balanceCheck: statements.balanceCheck,
    dashboard: { totalSources, totalUses, totalDebt, equityRequirement: sum(equityContrib), idc: totalIdc, fees: totalFees, dsra: Math.max(...dsra, 0), minDSCR: finiteDscr.length ? Math.min(...finiteDscr) : Infinity, avgDSCR: finiteDscr.length ? sum(finiteDscr) / finiteDscr.length : Infinity, llcr: Math.min(...covenants.llcr.filter(Number.isFinite), Infinity), plcr: Math.min(...covenants.plcr.filter(Number.isFinite), Infinity), projectIrr: irr([-construction.totalCapex, ...cfads]), equityIrr: irr([-Math.max(1, sum(equityContrib)), ...distributions]), balanceSheetBalanced },
    audit,
  };
}
