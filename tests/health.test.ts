import { describe, expect, it } from "vitest";
import { bandOf, batteryHealth, pvHealth } from "../src/lib/ai/health";

const healthyPv = { performanceRatio: 1, anomalies30d: 0, dataQuality: 1, openFaultWeight: 0, ageYears: 1 };
const healthyBattery = { soh: 97, tempC: 30, spreadMv: 25, cycles: 300, anomalies30d: 0, openFaultWeight: 0 };

describe("health score", () => {
  it("stays within 0 to 100 on extreme and invalid input", () => {
    const extremes = [-5, 0, 0.5, 1, 3, 1e6, Number.NaN, Number.POSITIVE_INFINITY];
    for (const v of extremes) {
      const pv = pvHealth({ performanceRatio: v, anomalies30d: v, dataQuality: v, openFaultWeight: v, ageYears: v });
      const batt = batteryHealth({ soh: v, tempC: v, spreadMv: v, cycles: v, anomalies30d: v, openFaultWeight: v });
      for (const s of [pv.score, batt.score]) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });

  it("has a breakdown that adds up to the score", () => {
    for (const h of [pvHealth({ ...healthyPv, performanceRatio: 0.7, anomalies30d: 1 }), batteryHealth({ ...healthyBattery, soh: 81 })]) {
      const sum = h.factors.reduce((a, f) => a + f.points, 0);
      expect(Math.abs(sum - h.score)).toBeLessThanOrEqual(0.5);
      expect(h.factors.reduce((a, f) => a + f.max, 0)).toBe(100);
    }
  });

  it("drops when a PV system stops producing or a fault is open", () => {
    const good = pvHealth(healthyPv).score;
    expect(good).toBeGreaterThanOrEqual(85);
    expect(pvHealth({ ...healthyPv, performanceRatio: 0, openFaultWeight: 1 }).score).toBeLessThan(50);
  });

  it("drops with battery temperature and low SoH", () => {
    const good = batteryHealth(healthyBattery).score;
    expect(good).toBeGreaterThanOrEqual(85);
    expect(batteryHealth({ ...healthyBattery, tempC: 60 }).score).toBeLessThan(good);
    expect(batteryHealth({ ...healthyBattery, soh: 70 }).score).toBeLessThan(good);
  });

  it("maps scores to the configured bands", () => {
    expect(bandOf(85)).toBe("sangat_baik");
    expect(bandOf(84)).toBe("baik");
    expect(bandOf(69)).toBe("perhatian");
    expect(bandOf(49)).toBe("prioritas");
  });
});
