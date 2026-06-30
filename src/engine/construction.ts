import { Period, ProjectModel } from './types';

export function buildConstructionFunding(project: ProjectModel, periods: Period[]) {
  const scenario = project.scenarios.find(s => s.id === project.activeScenarioId) ?? project.scenarios[0];
  const totalCapex = project.construction.capex * (scenario?.capexMultiplier ?? 1) + project.construction.contingency + project.construction.costOverrunReserve + project.construction.vatBridge;
  const constructionIndexes = periods.map((p, i) => p.phase === 'construction' ? i : -1).filter(i => i >= 0);
  const weights = constructionIndexes.map((_, i) => {
    const n = constructionIndexes.length;
    if (project.construction.drawdownProfile === 'front-loaded') return n - i;
    if (project.construction.drawdownProfile === 'back-loaded') return i + 1;
    if (project.construction.drawdownProfile === 'custom placeholder') return 1;
    return 1;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const draw = periods.map(() => 0);
  constructionIndexes.forEach((idx, pos) => { draw[idx] = totalCapex * weights[pos] / totalWeight; });
  return { totalCapex, draw };
}
