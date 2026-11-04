import { pvPowerW } from "../sim/physics";

/** Expected AC power from measured irradiance and temperature, with the system's own baseline PR. */
export function expectedPowerW(capacityKwp: number, irradiance: number, ambientC: number, baselinePr: number): number {
  return pvPowerW(capacityKwp, irradiance, ambientC, baselinePr);
}
