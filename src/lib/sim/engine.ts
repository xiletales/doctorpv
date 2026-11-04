import { activeFaults, indexFaults, type Fault, type FaultIndex } from "./faults";
import { ambientC, cellTempC, irradiance, loadW, pvPowerW } from "./physics";
import { hash01 } from "./rng";
import { DAY, hourOfDay } from "./time";
import type { BatteryDef, HouseDef, World } from "./world";

const SOC_MIN = 10;
const SOC_MAX = 95;
const ETA = 0.95;
const C_RATE = 0.5;

export interface PvSample {
  id: string;
  zoneId: string;
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
  zoneId: string;
  voltage: number;
  currentA: number;
  soc: number;
  soh: number;
  tempC: number;
  spreadMv: number;
  cycles: number;
  bms: "OK" | "WARN" | "ALARM";
}

export interface ZoneSample {
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
  zones: ZoneSample[];
}

export interface EngineOptions {
  world: World;
  faults: Fault[];
  refDayStart: number;
  demoDay: number;
}

interface Pair {
  battery: BatteryDef;
  pv: number;
  load: number;
  charge: number;
  discharge: number;
  surplus: number;
  deficit: number;
  pln: number;
  curtail: number;
  room: number;
  avail: number;
}

export class Engine {
  readonly world: World;
  private faults: FaultIndex;
  private housesByBattery = new Map<string, HouseDef[]>();
  private soc = new Map<string, number>();
  private readonly refDayStart: number;
  private readonly demoDay: number;
  /** Scenario hooks: a cloud multiplier, and days added to battery ageing. */
  cloudOverride: number | null = null;
  ageShiftDays = 0;

  constructor(opts: EngineOptions) {
    this.world = opts.world;
    this.faults = indexFaults(opts.faults);
    this.refDayStart = opts.refDayStart;
    this.demoDay = opts.demoDay;
    for (const b of opts.world.batteries) {
      this.housesByBattery.set(b.id, opts.world.houses.filter((h) => h.batteryId === b.id));
      this.soc.set(b.id, 55);
    }
  }

  setFaults(faults: Fault[]): void {
    this.faults = indexFaults(faults);
  }

  /** Runs the battery state forward without keeping any samples. */
  warmUp(from: number, to: number, step = 300): void {
    for (let t = from; t < to; t += step) this.step(t, step);
  }

  /**
   * Advances dispatch by dt seconds and returns the state at ts. dt = 0 only reads.
   * Each house pair uses its own battery first. What is left goes over the cluster bus:
   * surplus serves other pairs' deficits, then charges other batteries, then is curtailed.
   * Remaining deficit discharges other batteries, and PLN covers the rest.
   */
  step(ts: number, dt: number): WorldSample {
    const g = irradiance(ts, this.demoDay) * (this.cloudOverride ?? 1);
    const ambient = ambientC(ts);
    const pv: PvSample[] = [];
    const pairs: Pair[] = [];

    for (const battery of this.world.batteries) {
      const houses = this.housesByBattery.get(battery.id) ?? [];
      const pair: Pair = { battery, pv: 0, load: 0, charge: 0, discharge: 0, surplus: 0, deficit: 0, pln: 0, curtail: 0, room: 0, avail: 0 };
      for (const h of houses) {
        const s = this.pvSample(h, ts, g, ambient);
        pv.push(s);
        pair.pv += s.trueW;
        pair.load += loadW(h.index, h.loadScale, ts);
      }
      const soc = this.soc.get(battery.id) ?? 55;
      const maxP = battery.capacityKwh * 1000 * C_RATE;
      pair.room = soc < SOC_MAX ? maxP * Math.min(1, (SOC_MAX - soc) / 3) : 0;
      pair.avail = soc > SOC_MIN ? maxP * Math.min(1, (soc - SOC_MIN) / 3) : 0;
      const net = pair.pv - pair.load;
      if (net >= 0) {
        pair.charge = Math.min(net, pair.room);
        pair.surplus = net - pair.charge;
      } else {
        pair.discharge = Math.min(-net, pair.avail);
        pair.deficit = -net - pair.discharge;
      }
      pairs.push(pair);
    }

    const totalSurplus = pairs.reduce((a, p) => a + p.surplus, 0);
    const totalDeficit = pairs.reduce((a, p) => a + p.deficit, 0);
    const shared = Math.min(totalSurplus, totalDeficit);
    let surplusLeft = totalSurplus - shared;
    let deficitLeft = totalDeficit - shared;

    const roomLeft = pairs.reduce((a, p) => a + (p.room - p.charge), 0);
    if (surplusLeft > 0 && roomLeft > 0) {
      const used = Math.min(surplusLeft, roomLeft);
      for (const p of pairs) p.charge += (used * (p.room - p.charge)) / roomLeft;
      surplusLeft -= used;
    }
    const availLeft = pairs.reduce((a, p) => a + (p.avail - p.discharge), 0);
    if (deficitLeft > 0 && availLeft > 0) {
      const used = Math.min(deficitLeft, availLeft);
      for (const p of pairs) p.discharge += (used * (p.avail - p.discharge)) / availLeft;
      deficitLeft -= used;
    }
    for (const p of pairs) {
      p.curtail = totalSurplus > 0 ? (surplusLeft * p.surplus) / totalSurplus : 0;
      p.pln = totalDeficit > 0 ? (deficitLeft * p.deficit) / totalDeficit : 0;
    }

    const batteries: BatterySample[] = [];
    for (const p of pairs) {
      let soc = this.soc.get(p.battery.id) ?? 55;
      if (dt > 0) {
        const capacityWh = p.battery.capacityKwh * 1000 * (this.sohAt(p.battery, ts) / 100);
        soc += ((p.charge * ETA - p.discharge / ETA) * (dt / 3600) * 100) / capacityWh;
        soc = Math.max(SOC_MIN, Math.min(SOC_MAX, soc));
        this.soc.set(p.battery.id, soc);
      }
      batteries.push(this.batterySample(p.battery, ts, soc, p.charge - p.discharge, ambient));
    }

    const zones: ZoneSample[] = this.world.zones.map((zone) => {
      const list = pairs.filter((p) => p.battery.zoneId === zone.id);
      const sum = (f: (p: Pair) => number) => list.reduce((a, p) => a + f(p), 0);
      const socs = list.map((p) => this.soc.get(p.battery.id) ?? 55);
      return {
        id: zone.id,
        pvW: sum((p) => p.pv),
        loadW: sum((p) => p.load),
        plnW: sum((p) => p.pln),
        chargeW: sum((p) => p.charge),
        dischargeW: sum((p) => p.discharge),
        curtailW: sum((p) => p.curtail),
        soc: socs.reduce((a, b) => a + b, 0) / Math.max(socs.length, 1),
      };
    });
    return { ts, g, ambient, pv, batteries, zones };
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
      zoneId: h.zoneId,
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
    const days = (ts - this.refDayStart) / DAY + this.ageShiftDays;
    const wobble = (hash01(b.index, Math.floor(ts / DAY)) - 0.5) * 0.08;
    return b.sohRef - b.sohRatePerDay * days + wobble;
  }

  private batterySample(b: BatteryDef, ts: number, soc: number, perUnitW: number, ambient: number): BatterySample {
    const faults = activeFaults(this.faults, b.id, ts);
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
      zoneId: b.zoneId,
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
