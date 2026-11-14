export interface UplinkStats {
  id: string;
  name: string;
  type: 'native' | 'phone';
  enabled: boolean;
  weight: number;
  active_connections: number;
  latency_ms: number;
  bytes_in: number;
  bytes_out: number;
  speed_down_kbps: number;
  speed_up_kbps: number;
}

export interface HubMetrics {
  timestamp: number;
  total_speed_down_kbps: number;
  total_speed_up_kbps: number;
  total_active_connections: number;
  uplinks: UplinkStats[];
}

export interface QRData {
  ip: string;
  port: number;
  token: string;
  payload: string;
  qrSvg: string;
  qrDataUrl: string;
}
