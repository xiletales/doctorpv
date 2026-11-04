export interface MapZone {
  id: string;
  name: string;
  boundary: [number, number][];
  road: [number, number][];
  label: [number, number];
}

export interface MapHouse {
  id: string;
  batteryId: string;
  zoneId: string;
  ownerCode: string;
  ownerName: string | null;
  address: string;
  lat: number;
  lng: number;
  capacityKwp: number;
  panelCount: number;
  inverterModel: string;
  installDate: number;
}

export interface MapBattery {
  id: string;
  zoneId: string;
  lat: number;
  lng: number;
  chemistry: string;
  capacityKwh: number;
  installDate: number;
}

export interface MapGateway {
  id: string;
  zoneId: string;
  lat: number;
  lng: number;
  firmware: string;
}

export interface MapData {
  center: { lat: number; lng: number; zoom: number };
  boundary: [number, number][];
  zones: MapZone[];
  houses: MapHouse[];
  batteries: MapBattery[];
  gateways: MapGateway[];
}
