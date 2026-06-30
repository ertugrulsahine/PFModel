import { FundingInstrument, InstrumentType, ProjectModel, Seniority } from '../engine/types';

const instrumentTypes: InstrumentType[] = [
  'Equity',
  'Shareholder loan',
  'Senior debt',
  'Mezzanine debt',
  'Bridge loan',
  'ECA facility',
  'IFI / DFI facility',
  'VAT facility',
  'Working capital facility',
  'DSRA LC',
  'Refinancing debt',
  'Grant / subsidy',
];

function seniorityFor(type: InstrumentType): Seniority {
  if (type === 'Equity') return 'equity';
  if (type === 'Mezzanine debt') return 'mezzanine';
  return 'senior';
}

function makeInstrument(type: InstrumentType, index: number): FundingInstrument {
  const debtLike = !['Equity', 'Grant / subsidy', 'DSRA LC'].includes(type);
  return {
    id: `inst-${index}`,
    name: type,
    type,
    enabled: ['Equity', 'Senior debt', 'Mezzanine debt', 'DSRA LC', 'Grant / subsidy'].includes(type),
    currency: 'USD',
    commitment: type === 'Equity' ? 20_000_000 : type === 'Senior debt' ? 40_000_000 : 5_000_000,
    availableFrom: '2026-01-01',
    availableUntil: '2027-01-01',
    fundingPriority: index + 1,
    repaymentPriority: index + 1,
    seniority: seniorityFor(type),
    interestType: 'fixed',
    baseRate: 0,
    margin: 0.025,
    fixedRate: type === 'Equity' || type === 'Grant / subsidy' ? 0 : 0.07,
    commitmentFee: 0.01,
    upfrontFee: 0.015,
    arrangementFee: 0.005,
    agencyFee: 25_000,
    undrawnFee: 0.004,
    capitalizedInterest: true,
    accruedInterest: false,
    debtFundedFees: true,
    equityFundedFees: false,
    repaymentType: type === 'Senior debt' ? 'Sculpted repayment' : 'Bullet',
    tenorMonths: 96,
    gracePeriodMonths: 12,
    maturity: '2035-01-01',
    cashSweep: type === 'Senior debt',
    refinancingEligible: type === 'Senior debt',
    covenantPackage: 'Base covenant package',
    distributionRestrictionRules: ['No distribution during construction', 'Backward DSCR passes', 'Minimum cash balance'],
    sizingMethod: type === 'Senior debt' ? 'Target DSCR' : 'Custom debt amount',
    targetDSCR: 1.35,
    maxGearing: 0.7,
    fundingMethod:
      type === 'Equity'
        ? 'Residual funding / balancing item'
        : type === 'Senior debt' || type === 'Mezzanine debt'
          ? '% of total debt'
          : 'Fixed amount',
    fundingPercentage: type === 'Senior debt' ? 0.8 : type === 'Mezzanine debt' ? 0.2 : 0,
    fundingCap: type === 'Senior debt' ? 40_000_000 : type === 'Mezzanine debt' ? 15_000_000 : 1_000_000_000_000,
    fundingFloor: 0,
    availableDuringConstruction: true,
    includeInDebtSizing: debtLike,
    residualFunding: type === 'Equity',
  };
}

const sampleProjectBase: Omit<ProjectModel, 'funding'> = {
  name: 'PF Modeler Demo Project',
  currency: 'USD',
  timeline: {
    frequency: 'quarterly',
    projectStart: '2026-01-01',
    constructionStart: '2026-01-01',
    cod: '2027-01-01',
    operationEnd: '2036-12-31',
    financingTenorMonths: 96,
    gracePeriodMonths: 12,
    repaymentPeriodMonths: 84,
  },
  operating: {
    revenue: 12_000_000,
    operatingCost: 3_600_000,
    maintenanceCapex: 500_000,
    taxRate: 0.25,
    workingCapitalMovement: 100_000,
    depreciation: 1_000_000,
  },
  construction: {
    capex: 50_000_000,
    contingency: 2_500_000,
    costOverrunReserve: 1_000_000,
    drawdownProfile: 'straight-line',
  },
  instruments: instrumentTypes.map(makeInstrument),
  reserves: [
    {
      id: 'dsra',
      name: 'Debt Service Reserve Account',
      type: 'DSRA',
      method: 'Next 6 months debt service',
      months: 6,
      fixedAmount: 0,
      funding: 'debt funded',
    },
    {
      id: 'mra',
      name: 'Maintenance reserve',
      type: 'Maintenance reserve account',
      method: 'Fixed amount',
      months: 0,
      fixedAmount: 250_000,
      funding: 'cash funded',
    },
  ],
  covenants: {
    backwardDSCR: 1.2,
    forwardDSCR: 1.25,
    llcr: 1.3,
    plcr: 1.4,
    debtToEbitda: 5,
    minimumCash: 500_000,
    distributionLockup: true,
    cashTrap: true,
    defaultTrigger: true,
    equityCure: true,
    guaranteeRelease: {
      forwardDSCR: 1.3,
      llcr: 1.4,
      firstPrincipal: true,
      secondPrincipal: true,
      cod: true,
      noDefault: true,
      minimumOperatingPeriods: 4,
    },
  },
  scenarios: [
    { id: 'base', name: 'Base case', revenueMultiplier: 1, opexMultiplier: 1, capexMultiplier: 1, rateShock: 0 },
    { id: 'upside', name: 'Upside', revenueMultiplier: 1.1, opexMultiplier: 0.97, capexMultiplier: 0.98, rateShock: -0.005 },
    { id: 'downside', name: 'Downside', revenueMultiplier: 0.9, opexMultiplier: 1.05, capexMultiplier: 1.08, rateShock: 0.01 },
  ],
  activeScenarioId: 'base',
};

export const sampleProject: ProjectModel = Object.assign(sampleProjectBase, {
  funding: {
    targetGearing: 0.7,
    equityResidual: true,
    tolerance: 1,
  },
});
