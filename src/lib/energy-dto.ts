export interface EnergyTotals {
  pv: number;
  load: number;
  pln: number;
  charge: number;
  discharge: number;
  curtail: number;
}

export interface EnergyPoint {
  ts: number;
  pvDirect: number;
  discharge: number;
  pln: number;
}

export interface EnergyDto {
  scopeLabel: string;
  simTs: number;
  dayStart: number;
  today: { totals: EnergyTotals; curve: EnergyPoint[] };
  yesterday: { totals: EnergyTotals; curve: EnergyPoint[] };
  recommendations: string[];
  tariffRp: number;
  emissionFactor: number;
}
