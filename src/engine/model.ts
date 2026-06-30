import { buildConstructionFunding } from './construction';
import { buildCovenants } from './covenants';
import { allocateDebt, buildDebtSchedules } from './debt';
import { bullet, dscr, irr, sculpted, sizeByDSCR, sizeByGearing, straightLine, sum } from './finance';
import { buildOperatingModel } from './operating';
import { buildDsra } from './reserves';
import { buildStatements } from './statements';
import { generateTimeline } from './timeline';
import { FundingSummary, ModelResults, ProjectModel, SolverLogEntry, SourcesUsesLine } from './types';
import { validateProject } from './validation';

export { validateProject } from './validation';
export { bullet, dscr, sculpted, sizeByDSCR, sizeByGearing, straightLine } from './finance';

function buildSourcesUses(summary: FundingSummary): SourcesUsesLine[] {
  return [
    ...Object.entries(summary.usesBreakdown).map(([label, amount]) => ({ section: 'Uses' as const, label, amount })),
    { section: 'Uses' as const, label: 'Total Uses / Final Project Cost', amount: summary.totalUses },
    ...Object.entries(summary.sourcesBreakdown).map(([label, amount]) => ({ section: 'Sources' as const, label, amount })),
    { section: 'Sources' as const, label: 'Total Sources', amount: summary.totalSources },
    { section: 'Check' as const, label: summary.balanced ? 'Balanced' : 'Not balanced', amount: summary.sourcesUsesDifference },
  ];
}

export function calculateModel(project: ProjectModel): ModelResults {
  const audit: string[] = [];
  const periods = generateTimeline(project.timeline);
  audit.push(`Generated ${periods.length} ${project.timeline.frequency} periods.`);
  const validation = validateProject(project);
  const operating = buildOperatingModel(project, periods);
  const construction = buildConstructionFunding(project, periods);
  const lcCommitment = sum(project.instruments.filter(i => i.enabled && i.type === 'DSRA LC').map(i => i.commitment));
  const grantAmount = sum(project.instruments.filter(i => i.enabled && i.type === 'Grant / subsidy').map(i => i.commitment));
  const tolerance = project.funding.tolerance || 1;
  let estimatedTotalUses = construction.totalCapex;
  let debtAllocation: Record<string, number> = {};
  let targetDebt = 0;
  let debtSchedules = buildDebtSchedules(project, periods, operating.cfadsBeforeDebt, debtAllocation);
  let debtService = periods.map((_, i) => sum(debtSchedules.map(d => d.interest[i] + d.principal[i] + d.cashSweep[i])));
  let reserveSchedule = buildDsra(project, debtService, lcCommitment);
  const log: SolverLogEntry[] = [];
  let finalDelta = Infinity;
  let fundingSummary: FundingSummary = {
    baseCapex: construction.totalCapex,
    financingCosts: 0,
    totalUses: construction.totalCapex,
    totalSources: construction.totalCapex,
    targetDebt: 0,
    equityFunding: Math.max(0, construction.totalCapex - grantAmount),
    grants: grantAmount,
    sourcesUsesDifference: 0,
    balanced: true,
    debtAllocation: {},
    usesBreakdown: {},
    sourcesBreakdown: {},
  };

  for (let iteration = 1; iteration <= 100; iteration += 1) {
    const allocation = allocateDebt(project, estimatedTotalUses);
    targetDebt = allocation.targetDebt;
    debtAllocation = allocation.allocation;
    debtSchedules = buildDebtSchedules(project, periods, operating.cfadsBeforeDebt, debtAllocation);
    debtService = periods.map((_, i) => sum(debtSchedules.map(d => d.interest[i] + d.principal[i] + d.cashSweep[i])));
    reserveSchedule = buildDsra(project, debtService, lcCommitment);
    const capitalizedInterest = sum(debtSchedules.map(d => sum(d.capitalizedInterest)));
    const enabledDebt = project.instruments.filter(i => i.enabled && debtAllocation[i.id] !== undefined);
    const upfrontFees = sum(enabledDebt.map(i => (debtAllocation[i.id] ?? 0) * i.upfrontFee));
    const arrangementFees = sum(enabledDebt.map(i => (debtAllocation[i.id] ?? 0) * i.arrangementFee));
    const commitmentFees = sum(enabledDebt.map(i => (debtAllocation[i.id] ?? 0) * i.commitmentFee));
    const agencyFees = sum(enabledDebt.map(i => i.agencyFee));
    const undrawnFees = sum(enabledDebt.map(i => (debtAllocation[i.id] ?? 0) * i.undrawnFee));
    const financingFees = upfrontFees + arrangementFees + commitmentFees + agencyFees + undrawnFees;
    const dsraFunding = Math.max(...reserveSchedule.closingBalance, 0);
    const financingCosts = capitalizedInterest + financingFees + dsraFunding;
    const totalUses = construction.totalCapex + financingCosts;
    const totalDebt = sum(Object.values(debtAllocation));
    const equityFunding = Math.max(0, totalUses - totalDebt - grantAmount);
    const totalSources = totalDebt + equityFunding + grantAmount;
    const sourcesUsesDifference = totalSources - totalUses;
    finalDelta = Math.max(Math.abs(totalUses - estimatedTotalUses), Math.abs(sourcesUsesDifference));
    fundingSummary = {
      baseCapex: construction.totalCapex,
      financingCosts,
      totalUses,
      totalSources,
      targetDebt,
      equityFunding,
      grants: grantAmount,
      sourcesUsesDifference,
      balanced: Math.abs(sourcesUsesDifference) <= tolerance,
      debtAllocation,
      usesBreakdown: {
        'Base CAPEX / Base Project Cost': project.construction.capex,
        Contingency: project.construction.contingency,
        'Cost overrun reserve': project.construction.costOverrunReserve,
        IDC: capitalizedInterest,
        'Capitalized interest': 0,
        'Upfront fees': upfrontFees,
        'Arrangement fees': arrangementFees,
        'Commitment fees': commitmentFees,
        'Agency fees': agencyFees,
        'Undrawn fees': undrawnFees,
        'Debt-funded fees': financingFees,
        'DSRA funding': dsraFunding,
        'Other financing costs': 0,
      },
      sourcesBreakdown: {
        Equity: equityFunding,
        'Shareholder loan': sum(debtSchedules.filter(d => d.type === 'Shareholder loan').map(d => debtAllocation[d.instrumentId] ?? 0)),
        'Senior debt': sum(debtSchedules.filter(d => d.type === 'Senior debt').map(d => debtAllocation[d.instrumentId] ?? 0)),
        'Mezzanine debt': sum(debtSchedules.filter(d => d.type === 'Mezzanine debt').map(d => debtAllocation[d.instrumentId] ?? 0)),
        'Bridge loan': sum(debtSchedules.filter(d => d.type === 'Bridge loan').map(d => debtAllocation[d.instrumentId] ?? 0)),
        'ECA facility': sum(debtSchedules.filter(d => d.type === 'ECA facility').map(d => debtAllocation[d.instrumentId] ?? 0)),
        'IFI / DFI facility': sum(debtSchedules.filter(d => d.type === 'IFI / DFI facility').map(d => debtAllocation[d.instrumentId] ?? 0)),
        'Working capital facility': sum(debtSchedules.filter(d => d.type === 'Working capital facility').map(d => debtAllocation[d.instrumentId] ?? 0)),
        'Refinancing debt': sum(debtSchedules.filter(d => d.type === 'Refinancing debt').map(d => debtAllocation[d.instrumentId] ?? 0)),
        'Grants / subsidies': grantAmount,
        'Other sources': 0,
      },
    };
    log.push({ iteration, variable: 'funding circularity', previous: estimatedTotalUses, next: totalUses, delta: finalDelta, note: finalDelta <= tolerance ? 'converged' : 'recalculate debt sizing and financing costs', baseCapex: construction.totalCapex, financingCosts, totalUses, targetDebt, debtAllocation: { ...debtAllocation }, equityFunding, sourcesUsesDifference });
    estimatedTotalUses = estimatedTotalUses * 0.25 + totalUses * 0.75;
    if (finalDelta <= tolerance) break;
  }

  const failed = finalDelta > tolerance;
  const interest = periods.map((_, i) => sum(debtSchedules.map(d => d.interest[i])));
  const principal = periods.map((_, i) => sum(debtSchedules.map(d => d.principal[i] + d.cashSweep[i])));
  const fees = periods.map((_, i) => sum(debtSchedules.map(d => d.fees[i])));
  const idc = periods.map((p, i) => p.phase === 'construction' ? sum(debtSchedules.map(d => d.capitalizedInterest[i])) : 0);
  const debtDraws = periods.map((_, i) => sum(debtSchedules.map(d => d.drawdown[i])));
  const closingDebt = periods.map((_, i) => sum(debtSchedules.map(d => d.closingBalance[i])));
  const cfads = operating.cfadsBeforeDebt;
  const covenants = buildCovenants(project, cfads, principal.map((p, i) => p + interest[i]), closingDebt);
  const dsra = reserveSchedule.closingBalance;
  const constructionCount = periods.filter(p => p.phase === 'construction').length || 1;
  const grantContrib = periods.map(p => p.phase === 'construction' ? grantAmount / constructionCount : 0);
  const equityContrib = periods.map(p => p.phase === 'construction' ? fundingSummary.equityFunding / constructionCount : 0);
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

  const statements = buildStatements({ periods, revenue: operating.revenue, operatingCosts: operating.operatingCosts, ebitda: operating.ebitda, depreciation: operating.depreciation, interest, tax: operating.tax, maintenance: operating.maintenanceCapex, wc: operating.workingCapital, constructionDraw: construction.draw, capitalizedFinancingCosts: idc.map((x, i) => x + fees[i]), debtSchedules, dsra, distributions, closingCash, equityContrib, grants: grantContrib });
  const dscrs = dscr(cfads, principal.map((p, i) => p + interest[i]));
  const finiteDscr = dscrs.filter(Number.isFinite);
  const totalDebt = sum(Object.values(fundingSummary.debtAllocation));
  const totalFees = sum(fees);
  const totalIdc = sum(idc);
  const balanceSheetBalanced = statements.balanceCheck.every(x => Math.abs(x) < 1.5);
  const warnings = [
    ...validation.filter(v => v.severity === 'warning').map(v => v.message),
    ...(failed ? ['Funding circularity solver failure.'] : []),
    ...(!fundingSummary.balanced ? ['Sources and uses are not balanced.'] : []),
    ...(!balanceSheetBalanced ? ['Balance sheet not balancing.'] : []),
  ];
  const sourcesUses = buildSourcesUses(fundingSummary);
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
    equityIrr: irr([-Math.max(1, fundingSummary.equityFunding), ...distributions]),
    sourcesUses,
    fundingSummary,
    incomeStatement: statements.incomeStatement,
    balanceSheet: statements.balanceSheet,
    cashFlowStatement: statements.cashFlowStatement,
    waterfall,
    debtSchedules,
    reserveSchedule,
    covenants,
    solver: { status: failed ? 'failed' : 'converged', iterations: log.length, tolerance, finalDelta, variables: ['Base CAPEX', 'Total uses', 'Target gearing debt', 'Debt allocation', 'IDC', 'Debt-funded fees', 'DSRA funding', 'Equity residual', 'Sources-uses balance'], bindingConstraint: `${(project.funding.targetGearing * 100).toFixed(1)}% target gearing on total uses`, failureReason: failed ? 'Funding circularity not converging; review gearing, fees, DSRA and debt allocation caps.' : undefined, warnings, log },
    validation,
    warnings,
    balanceCheck: statements.balanceCheck,
    dashboard: { totalSources: fundingSummary.totalSources, totalUses: fundingSummary.totalUses, totalDebt, equityRequirement: fundingSummary.equityFunding, idc: totalIdc, fees: totalFees, dsra: Math.max(...dsra, 0), minDSCR: finiteDscr.length ? Math.min(...finiteDscr) : Infinity, avgDSCR: finiteDscr.length ? sum(finiteDscr) / finiteDscr.length : Infinity, llcr: Math.min(...covenants.llcr.filter(Number.isFinite), Infinity), plcr: Math.min(...covenants.plcr.filter(Number.isFinite), Infinity), projectIrr: irr([-construction.totalCapex, ...cfads]), equityIrr: irr([-Math.max(1, fundingSummary.equityFunding), ...distributions]), balanceSheetBalanced },
    audit,
  };
}
