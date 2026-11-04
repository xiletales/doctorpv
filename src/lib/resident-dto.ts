import type { AssetStatus } from "./types";

export interface ResidentDto {
  houseId: string;
  ownerName: string;
  address: string;
  capacityKwp: number;
  simTs: number;
  acW: number;
  expectedW: number;
  todayKwh: number;
  status: AssetStatus;
  savingsRp: number;
  tariffRp: number;
  today: { ts: number; w: number }[];
  battery: { id: string; soc: number; status: AssetStatus; charging: boolean; discharging: boolean };
  issues: { id: string; message: string; recommendedAction: string; createdAt: number }[];
}
