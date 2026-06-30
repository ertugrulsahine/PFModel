import { Period, ProjectModel } from './types';

export function buildOperatingModel(project: ProjectModel, periods: Period[]) {
  const scenario = project.scenarios.find(s => s.id === project.activeScenarioId) ?? project.scenarios[0];
  const py = periods.length / Math.max(1, new Set(periods.map(p => p.year)).size);
  const revenue: number[] = [];
  const operatingCosts: number[] = [];
  const maintenanceCapex: number[] = [];
  const workingCapital: number[] = [];
  const depreciation: number[] = [];
  const tax: number[] = [];
  const ebitda: number[] = [];
  const cfadsBeforeDebt: number[] = [];
  periods.forEach((p) => {
    const opYear = Math.max(0, p.year - new Date(`${project.timeline.cod}T00:00:00Z`).getUTCFullYear());
    const revEsc = Math.pow(1 + (project.operating.revenueEscalation ?? 0), opYear);
    const costEsc = Math.pow(1 + (project.operating.costEscalation ?? 0), opYear);
    const isOp = p.phase === 'operation';
    const rev = isOp ? project.operating.revenue * (scenario?.revenueMultiplier ?? 1) * revEsc / py : 0;
    const opex = isOp ? project.operating.operatingCost * (scenario?.opexMultiplier ?? 1) * costEsc / py : 0;
    const maint = isOp ? project.operating.maintenanceCapex / py : 0;
    const wc = isOp ? project.operating.workingCapitalMovement / py : 0;
    const dep = isOp ? project.operating.depreciation / py : 0;
    const e = rev - opex;
    const taxable = Math.max(0, e - dep);
    const t = taxable * project.operating.taxRate;
    revenue.push(rev); operatingCosts.push(opex); maintenanceCapex.push(maint); workingCapital.push(wc); depreciation.push(dep); tax.push(t); ebitda.push(e); cfadsBeforeDebt.push(e - t - maint - wc);
  });
  return { revenue, operatingCosts, maintenanceCapex, workingCapital, depreciation, tax, ebitda, cfadsBeforeDebt };
}
