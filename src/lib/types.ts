export type Role = "dlh" | "admin" | "teknisi" | "warga";
export type AssetStatus = "normal" | "warning" | "critical" | "offline" | "maintenance";
export type AlertPriority = "critical" | "high" | "medium" | "low";
export type AlertStatus = "open" | "acknowledged" | "in_progress" | "resolved";

export const ROLE_LABEL: Record<Role, string> = {
  dlh: "Super Admin DLH",
  admin: "Admin Klaster",
  teknisi: "Teknisi",
  warga: "Warga",
};

export const STATUS_LABEL: Record<AssetStatus, string> = {
  normal: "Normal",
  warning: "Waspada",
  critical: "Kritis",
  offline: "Offline",
  maintenance: "Pemeliharaan",
};

export const PRIORITY_LABEL: Record<AlertPriority, string> = {
  critical: "Kritis",
  high: "Tinggi",
  medium: "Sedang",
  low: "Rendah",
};

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: "Terbuka",
  acknowledged: "Diterima",
  in_progress: "Ditangani",
  resolved: "Selesai",
};

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Set only for Warga: the single house this account may see. */
  houseId: string | null;
}
