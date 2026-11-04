export interface MapGang {
  id: string;
  name: string;
  boundary: [number, number][];
  alley: [number, number][];
  label: [number, number];
}

export interface MapHouse {
  id: string;
  gangId: string;
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
  gangId: string;
  lat: number;
  lng: number;
  chemistry: string;
  capacityKwh: number;
  installDate: number;
}

export interface MapGateway {
  id: string;
  gangId: string;
  lat: number;
  lng: number;
  firmware: string;
}

export interface MapData {
  center: { lat: number; lng: number; zoom: number };
  gangs: MapGang[];
  houses: MapHouse[];
  batteries: MapBattery[];
  gateways: MapGateway[];
}
