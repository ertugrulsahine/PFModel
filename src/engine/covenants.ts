import { dscr, sum } from './finance';
import { CovenantSummary, ProjectModel } from './types';

export function buildCovenants(project: ProjectModel, cfads: number[], debtService: number[], totalDebt: number[]) : CovenantSummary {
  const backwardDSCR = dscr(cfads, debtService);
  const forwardDSCR = cfads.map((_, i) => {
    const cf = sum(cfads.slice(i, i + 4));
    const ds = sum(debtService.slice(i, i + 4));
    return ds > 0 ? cf / ds : Infinity;
  });
  const llcr = cfads.map((_, i) => totalDebt[i] > 0 ? sum(cfads.slice(i)) / totalDebt[i] : Infinity);
  const plcr = cfads.map((_, i) => totalDebt[i] > 0 ? sum(cfads.slice(i)) / totalDebt[i] : Infinity);
  const distributionLocked = backwardDSCR.map((x, i) => x < project.covenants.backwardDSCR || forwardDSCR[i] < project.covenants.forwardDSCR || llcr[i] < project.covenants.llcr);
  const cashTrap = backwardDSCR.map(x => project.covenants.cashTrap && x < project.covenants.backwardDSCR + 0.1);
  const defaultTrigger = backwardDSCR.map(x => project.covenants.defaultTrigger && x < 1.0);
  return { backwardDSCR, forwardDSCR, llcr, plcr, distributionLocked, cashTrap, defaultTrigger };
}
