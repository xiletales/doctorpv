import { activeFaults, indexFaults, type Fault, type FaultIndex } from "./faults";
import { ambientC, cellTempC, irradiance, loadW, pvPowerW } from "./physics";
import { hash01 } from "./rng";
import { DAY, hourOfDay } from "./time";
import type { BatteryDef, HouseDef, World } from "./world";

const SOC_MIN = 15;
const SOC_MAX = 95;
const ETA = 0.95;
const C_RATE = 0.5;

export interface PvSample {
  id: string;
  gangId: string;
  /** What the sensor reports. Differs from trueW when a sensor is faulty. */
  acW: number;
  trueW: number;
  dcV: number;
  dcI: number;
  tempC: number;
  inverter: "OK" | "TRIP" | "IDLE";
  offline: boolean;
}

export interface BatterySample {
  id: string;
  gangId: string;
  voltage: number;
  currentA: number;
  soc: number;
  soh: number;
  tempC: number;
  spreadMv: number;
  cycles: number;
  bms: "OK" | "WARN" | "ALARM";
}

export interface GangSample {
  id: string;
  pvW: number;
  loadW: number;
  plnW: number;
  chargeW: number;
  dischargeW: number;
  curtailW: number;
  soc: number;
}

export interface WorldSample {
  ts: number;
  g: number;
  ambient: number;
  pv: PvSample[];
  batteries: BatterySample[];
  gangs: GangSample[];
}

export interface EngineOptions {
  world: World;
  faults: Fault[];
  refDayStart: number;
  demoDay: number;
}

export class Engine {
  readonly world: World;
  private faults: FaultIndex;
  private housesByGang = new Map<string, HouseDef[]>();
  private battsByGang = new Map<string, BatteryDef[]>();
  private soc = new Map<string, number>();
  private readonly refDayStart: number;
  private readonly demoDay: number;

  constructor(opts: EngineOptions) {
    this.world = opts.world;
    this.faults = indexFaults(opts.faults);
    this.refDayStart = opts.refDayStart;
    this.demoDay = opts.demoDay;
    for (const g of opts.world.gangs) {
      this.housesByGang.set(g.id, opts.world.houses.filter((h) => h.gangId === g.id));
      this.battsByGang.set(g.id, opts.world.batteries.filter((b) => b.gangId === g.id));
      this.soc.set(g.id, 55);
    }
  }

  setFaults(faults: Fault[]): void {
    this.faults = indexFaults(faults);
  }

  /** Runs the battery state forward without keeping any samples. */
  warmUp(from: number, to: number, step = 300): void {
    for (let t = from; t < to; t += step) this.step(t, step);
  }

  /** Advances the gang dispatch by dt seconds and returns the state at ts. dt = 0 only reads. */
  step(ts: number, dt: number): WorldSample {
    const g = irradiance(ts, this.demoDay);
    const ambient = ambientC(ts);
    const pv: PvSample[] = [];
    const batteries: BatterySample[] = [];
    const gangs: GangSample[] = [];

    for (const gang of this.world.gangs) {
      const houses = this.housesByGang.get(gang.id) ?? [];
      const batts = this.battsByGang.get(gang.id) ?? [];
      let pvTotal = 0;
      let load = 0;
      for (const h of houses) {
        const s = this.pvSample(h, ts, g, ambient);
        pv.push(s);
        pvTotal += s.trueW;
        load += loadW(h.index, h.loadScale, ts);
      }

      const capacityWh = batts.reduce((a, b) => a + b.capacityKwh * 1000 * (this.sohAt(b, ts) / 100), 0);
      const maxP = batts.reduce((a, b) => a + b.capacityKwh * 1000 * C_RATE, 0);
      let soc = this.soc.get(gang.id) ?? 55;
      const net = pvTotal - load;
      let charge = 0;
      let discharge = 0;
      let curtail = 0;
      let pln = 0;
      if (net >= 0) {
        const room = soc < SOC_MAX ? maxP * Math.min(1, (SOC_MAX - soc) / 3) : 0;
        charge = Math.min(net, room);
        curtail = net - charge;
      } else {
        const need = -net;
        const avail = soc > SOC_MIN ? maxP * Math.min(1, (soc - SOC_MIN) / 3) : 0;
        discharge = Math.min(need, avail);
        pln = need - discharge;
      }
      if (dt > 0) {
        const hours = dt / 3600;
        soc += ((charge * ETA - discharge / ETA) * hours * 100) / capacityWh;
        soc = Math.max(SOC_MIN - 1, Math.min(SOC_MAX + 1, soc));
        this.soc.set(gang.id, soc);
      }
      gangs.push({ id: gang.id, pvW: pvTotal, loadW: load, plnW: pln, chargeW: charge, dischargeW: discharge, curtailW: curtail, soc });

      const perUnit = (charge - discharge) / batts.length;
      for (const b of batts) batteries.push(this.batterySample(b, ts, soc, perUnit, ambient));
    }
    return { ts, g, ambient, pv, batteries, gangs };
  }

  private pvSample(h: HouseDef, ts: number, g: number, ambient: number): PvSample {
    const faults = activeFaults(this.faults, h.id, ts);
    let factor = 1;
    let tripped = false;
    let stuck = false;
    let offline = false;
    for (const f of faults) {
      if (f.kind === "soiling") {
        const end = f.to ?? this.refDayStart + DAY;
        const start = f.from;
        const p = Math.min(1, (ts - start) / (end - start));
        factor *= 1 - (1 - (f.magnitude ?? 0.7)) * p;
      } else if (f.kind === "shading" && f.hours) {
        const hr = hourOfDay(ts);
        if (hr >= f.hours[0] && hr < f.hours[1]) factor *= f.magnitude ?? 0.5;
      } else if (f.kind === "inverter_trip") tripped = true;
      else if (f.kind === "sensor_stuck_zero") stuck = true;
      else if (f.kind === "device_offline") offline = true;
    }
    const noise = 0.985 + 0.03 * hash01(h.index, Math.floor(ts / 300));
    const base = pvPowerW(h.capacityKwp, g, ambient, h.pr) * factor * noise;
    const trueW = tripped ? 0 : base;
    const tempC = cellTempC(g, ambient) + (hash01(h.index, 5) - 0.5) * 2;
    const sun = g > 15;
    const voltsMax = 280 + 40 * h.capacityKwp;
    const dcV = sun ? voltsMax * (0.92 + 0.06 * Math.min(1, g / 800)) * (1 + GAMMA_V * (tempC - 25)) : 0;
    const dcI = sun && !tripped && dcV > 0 ? trueW / 0.965 / dcV : 0;
    return {
      id: h.id,
      gangId: h.gangId,
      acW: stuck ? 0 : trueW,
      trueW,
      dcV: tripped && sun ? dcV * 1.08 : dcV,
      dcI,
      tempC,
      inverter: tripped && sun ? "TRIP" : sun ? "OK" : "IDLE",
      offline,
    };
  }

  private sohAt(b: BatteryDef, ts: number): number {
    const days = (ts - this.refDayStart) / DAY;
    const wobble = (hash01(b.index, Math.floor(ts / DAY)) - 0.5) * 0.08;
    return b.sohRef - b.sohRatePerDay * days + wobble;
  }

  private batterySample(b: BatteryDef, ts: number, gangSoc: number, perUnitW: number, ambient: number): BatterySample {
    const faults = activeFaults(this.faults, b.id, ts);
    const soc = Math.max(5, Math.min(100, gangSoc + b.socOffset));
    const voltage = 48.2 + (soc / 100) * 5.6 + (perUnitW > 0 ? 0.3 : perUnitW < 0 ? -0.25 : 0);
    const currentA = perUnitW / voltage;
    let temp = ambient + 2.5 + b.tempOffset + Math.abs(currentA) * 0.11;
    let spread = 18 + hash01(b.index, 9) * 22 + Math.abs(currentA) * 0.25;
    let bms: BatterySample["bms"] = "OK";
    for (const f of faults) {
      if (f.kind === "thermal") {
        const p = Math.min(1, (ts - f.from) / 3600);
        temp += (f.magnitude ?? 10) * p;
        if (temp >= 45) bms = "ALARM";
      } else if (f.kind === "imbalance") {
        const p = Math.min(1, (ts - f.from) / DAY);
        spread += (f.magnitude ?? 120) * p;
        if (spread >= 120) bms = "WARN";
      }
    }
    const ageAtTs = b.ageDays + (ts - this.refDayStart) / DAY;
    return {
      id: b.id,
      gangId: b.gangId,
      voltage,
      currentA,
      soc,
      soh: this.sohAt(b, ts),
      tempC: temp,
      spreadMv: spread,
      cycles: ageAtTs * 0.85,
      bms,
    };
  }
}

const GAMMA_V = -0.0028;
