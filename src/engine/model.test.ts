import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { formatMoney, formatPercent, formatRatio } from './format';
import { calculateModel } from './model';
import { generateTimeline } from './timeline';
import { bullet, dscr, sculpted, sizeByDSCR, sizeByGearing, straightLine } from './finance';

const withFrequency = (frequency: typeof sampleProject.timeline.frequency) => ({ ...sampleProject, timeline: { ...sampleProject.timeline, frequency } });

describe('PF Modeler calculation engine', () => {
  it('generates monthly, quarterly, semi-annual, and annual timelines', () => {
    expect(generateTimeline(withFrequency('monthly').timeline).length).toBeGreaterThan(100);
    expect(generateTimeline(withFrequency('quarterly').timeline).length).toBeGreaterThan(40);
    expect(generateTimeline(withFrequency('semi-annual').timeline).length).toBeGreaterThan(15);
    expect(generateTimeline(withFrequency('annual').timeline).length).toBe(11);
  });

  it('returns full horizon output arrays', () => {
    const r = calculateModel(withFrequency('quarterly'));
    expect(r.revenue).toHaveLength(r.periods.length);
    expect(r.periods.length).toBeGreaterThan(12);
  });

  it('formats percentages, ratios, and currency', () => {
    expect(formatPercent(0.25)).toBe('25.0%');
    expect(formatRatio(1.3)).toBe('1.30x');
    expect(formatMoney(1_234_567)).toBe('1,234,567');
    expect(formatMoney(-1_234_567, true)).toBe('(1.2m)');
  });

  it('solves IDC circularity and debt-funded fees', () => {
    const r = calculateModel(sampleProject);
    expect(r.solver.status).toBe('converged');
    expect(r.idc.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(r.fees.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('sizes debt by gearing and DSCR', () => {
    expect(sizeByGearing(100, 0.7)).toBe(70);
    expect(sizeByDSCR([13, 13], 0, 1.3)).toBeCloseTo(20);
  });

  it('creates repayment profiles', () => {
    expect(straightLine(100, 4)).toEqual([25, 25, 25, 25]);
    expect(bullet(100, 3)).toEqual([0, 0, 100]);
    expect(sculpted([13, 13], 1.3, 20, 0)).toEqual([10, 10]);
  });

  it('builds senior, mezzanine, and shareholder loan schedules', () => {
    const p = { ...sampleProject, instruments: sampleProject.instruments.map(i => i.type === 'Shareholder loan' ? { ...i, enabled: true } : i) };
    const r = calculateModel(p);
    expect(r.debtSchedules.some(s => s.type === 'Senior debt')).toBe(true);
    expect(r.debtSchedules.some(s => s.type === 'Mezzanine debt')).toBe(true);
    expect(r.debtSchedules.some(s => s.type === 'Shareholder loan')).toBe(true);
  });

  it('calculates DSRA, DSCR and distribution restrictions', () => {
    const r = calculateModel(sampleProject);
    expect(Math.max(...r.dsra)).toBeGreaterThan(0);
    expect(dscr([10], [5])[0]).toBe(2);
    expect(r.distributions.slice(0, 4).every(x => x === 0)).toBe(true);
  });

  it('integrates financial statements with visible balance check', () => {
    const r = calculateModel(sampleProject);
    expect(r.balanceSheet['Balance check']).toHaveLength(r.periods.length);
    expect(r.cashFlowStatement['Closing cash']).toHaveLength(r.periods.length);
  });

  it('compares scenarios', () => {
    const base = calculateModel({ ...sampleProject, activeScenarioId: 'base' });
    const downside = calculateModel({ ...sampleProject, activeScenarioId: 'downside' });
    expect(base.dashboard.totalDebt).toBeGreaterThan(0);
    expect(downside.dashboard.totalUses).toBeGreaterThan(base.dashboard.totalUses);
  });
  it('keeps base CAPEX separate from financing costs and balances sources and uses', () => {
    const p = {
      ...sampleProject,
      construction: { ...sampleProject.construction, capex: 1000, contingency: 0, costOverrunReserve: 0, vatBridge: 0 },
      funding: { ...sampleProject.funding, targetGearing: 0.7, tolerance: 1 },
      instruments: sampleProject.instruments.map(i =>
        i.type === 'Senior debt' ? { ...i, enabled: true, fundingMethod: '% of total debt' as const, fundingPercentage: 0.8, fundingCap: 1_000_000, commitment: 1_000_000 } :
        i.type === 'Mezzanine debt' ? { ...i, enabled: true, fundingMethod: '% of total debt' as const, fundingPercentage: 0.2, fundingCap: 1_000_000, commitment: 1_000_000 } :
        i.type === 'Equity' ? { ...i, enabled: true, fundingMethod: 'Residual funding / balancing item' as const, commitment: 1_000_000 } :
        i.type === 'Grant / subsidy' ? { ...i, enabled: false, commitment: 0 } :
        { ...i, enabled: false }
      ),
    };
    const r = calculateModel(p);
    expect(r.fundingSummary.baseCapex).toBe(1000);
    expect(r.fundingSummary.totalUses).toBeCloseTo(r.fundingSummary.baseCapex + r.fundingSummary.financingCosts, 0);
    expect(r.fundingSummary.totalSources).toBeCloseTo(r.fundingSummary.totalUses, 0);
    expect(r.fundingSummary.targetDebt).toBeCloseTo(0.7 * r.fundingSummary.totalUses, 0);
    const senior = p.instruments.find(i => i.type === 'Senior debt')!;
    const mezz = p.instruments.find(i => i.type === 'Mezzanine debt')!;
    expect(r.fundingSummary.debtAllocation[senior.id]).toBeCloseTo(0.8 * r.fundingSummary.targetDebt, 0);
    expect(r.fundingSummary.debtAllocation[mezz.id]).toBeCloseTo(0.2 * r.fundingSummary.targetDebt, 0);
    expect(r.fundingSummary.equityFunding).toBeCloseTo(r.fundingSummary.totalUses - r.fundingSummary.targetDebt, 0);
    expect(r.fundingSummary.balanced).toBe(true);
  });

  it('disabled instruments have no funding impact', () => {
    const p = { ...sampleProject, instruments: sampleProject.instruments.map(i => i.type === 'Mezzanine debt' ? { ...i, enabled: false } : i) };
    const r = calculateModel(p);
    const mezz = p.instruments.find(i => i.type === 'Mezzanine debt')!;
    expect(r.fundingSummary.debtAllocation[mezz.id] ?? 0).toBe(0);
    expect(r.debtSchedules.some(s => s.instrumentId === mezz.id)).toBe(false);
  });

});
