/**
 * Site identity for the prototype. This file is the one place to change names.
 * RT assignments and house positions are simulated and have not been surveyed.
 */
export const PROJECT_TITLE =
  "SUNPULSE: Sistem Manajemen Energi Hibrida PLTS-Baterai-PLN Berbasis AIoT dengan Fault Detection and Diagnosis, Predictive Maintenance, dan Battery Health Management pada Klaster Permukiman";

export const SITE = {
  name: "Kampung Iklim RW 1",
  area: "Kelurahan Panularan, Kecamatan Laweyan, Kota Surakarta",
  partner: "DLH Kota Surakarta",
  center: { lat: -7.5741, lng: 110.8124 },
  zoom: 17.2,
};

/** Coverage area of each gateway. Change the labels here once the real RT names are confirmed. */
export const COVERAGE: Record<string, { label: string; gatewayId: string }> = {
  ZA: { label: "RT 01", gatewayId: "GW-1" },
  ZB: { label: "RT 02", gatewayId: "GW-2" },
  ZC: { label: "RT 03", gatewayId: "GW-3" },
};

export function areaLabel(id: string): string {
  if (id === "CLUSTER") return "Seluruh klaster";
  return COVERAGE[id]?.label ?? id;
}

export type FacilityKind = "musala" | "balai" | "sekolah";

/** Public buildings counted among the 30 points. All three are fictional. */
export const FACILITIES: Record<string, { kind: FacilityKind; name: string }> = {
  H03: { kind: "musala", name: "Musala" },
  H16: { kind: "balai", name: "Balai warga dan posyandu" },
  H25: { kind: "sekolah", name: "Sekolah" },
};

export const facilityOf = (houseId: string) => FACILITIES[houseId] ?? null;
