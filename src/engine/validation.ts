import { ProjectModel, ValidationMessage } from './types';
import { debtShareTotal } from './debt';

const debtTypes = new Set(['Senior debt', 'Mezzanine debt', 'Bridge loan', 'ECA facility', 'IFI / DFI facility', 'Working capital facility', 'Refinancing debt', 'Shareholder loan']);
const before = (a: string, b: string) => new Date(`${a}T00:00:00Z`) < new Date(`${b}T00:00:00Z`);

export function validateProject(p: ProjectModel): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  if (!p.timeline.cod) out.push({ severity: 'error', message: 'Missing COD.' });
  if (before(p.timeline.constructionStart, p.timeline.projectStart)) out.push({ severity: 'error', message: 'Construction start is before project start.' });
  if (!before(p.timeline.constructionStart, p.timeline.cod)) out.push({ severity: 'error', message: 'COD must be after construction start.' });
  if (!before(p.timeline.cod, p.timeline.operationEnd)) out.push({ severity: 'error', message: 'Operation end must be after COD.' });
  if (p.operating.taxRate < 0 || p.operating.taxRate > 1) out.push({ severity: 'error', message: 'Invalid tax rate.' });
  if (p.construction.capex < 0 || p.construction.contingency < 0 || p.construction.costOverrunReserve < 0) out.push({ severity: 'error', message: 'Negative construction costs are not allowed.' });
  p.instruments.filter(i => i.enabled).forEach(i => {
    if (i.commitment < 0) out.push({ severity: 'error', message: `${i.name}: negative commitment is not allowed.` });
    if (debtTypes.has(i.type) && i.fixedRate + i.baseRate + i.margin <= 0) out.push({ severity: 'error', message: `${i.name}: missing interest rate.` });
    if (debtTypes.has(i.type) && before(i.maturity, p.timeline.cod)) out.push({ severity: 'error', message: `${i.name}: debt maturity before COD.` });
    if (i.repaymentType === 'Sculpted repayment' && !i.targetDSCR) out.push({ severity: 'error', message: `${i.name}: missing DSCR target for sculpted repayment.` });
    if (i.sizingMethod.includes('Gearing') && (i.maxGearing <= 0 || i.maxGearing > 1)) out.push({ severity: 'error', message: `${i.name}: invalid gearing.` });
    if (['Annuity', 'Balloon', 'Mini-perm', 'Custom repayment profile'].includes(i.repaymentType)) out.push({ severity: 'warning', message: `${i.name}: ${i.repaymentType} is not fully implemented; straight-line fallback is used.` });
  });
  const shareTotal = debtShareTotal(p);
  if (shareTotal > 0 && Math.abs(shareTotal - 1) > 0.0001) out.push({ severity: 'warning', message: `Debt instruments using % of total debt sum to ${(shareTotal * 100).toFixed(1)}%, not 100.0%.` });
  if (p.funding.targetGearing < 0 || p.funding.targetGearing > 1) out.push({ severity: 'error', message: 'Target gearing must be between 0% and 100% of total uses.' });
  if (!p.reserves.some(r => r.type === 'DSRA')) out.push({ severity: 'warning', message: 'DSRA method missing.' });
  if (!p.covenants.backwardDSCR || !p.covenants.forwardDSCR || !p.covenants.llcr || !p.covenants.plcr) out.push({ severity: 'warning', message: 'Covenant thresholds missing.' });
  return out;
}
