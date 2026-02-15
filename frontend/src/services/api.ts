export interface SerialStatus {
  is_open: boolean;
  port: string | null;
  baudrate: number | null;
  timeout_ms?: number | null;
  clients: number;
  frames: number;
  queue_depth?: number;
  queue_peak?: number;
  queue_dropped?: number;
  write_queue_depth?: number;
  write_queue_peak?: number;
}

export interface PortOption {
  value: string;
  label: string;
}

export interface MavlinkParameter {
  name: string;
  value: number;
  type: number;
  index: number;
  count: number;
}

export interface MavlinkParametersResponse {
  parameters: MavlinkParameter[];
  received: number;
  expected: number | null;
  elapsed_ms: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

const SERIAL_ENDPOINTS = {
  status: '/serial/status',
  ports: '/serial/ports',
  open: '/serial/open',
  close: '/serial/close',
  write: '/serial/write',
  mavlinkParameters: '/mavlink/parameters',
};

const buildUrl = (path: string) => `${API_BASE_URL}${path}`;

const ensureOk = (response: Response, message: string) => {
  if (!response.ok) {
    throw new Error(message);
  }
};

export const getTelemetryWebSocketUrl = () => {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/telemetry';
  return url.toString();
};

export const getSerialStatus = async () => {
  const response = await fetch(buildUrl(SERIAL_ENDPOINTS.status));
  ensureOk(response, 'Unable to fetch serial status');
  return (await response.json()) as SerialStatus;
};

export const getSerialPorts = async () => {
  const response = await fetch(buildUrl(SERIAL_ENDPOINTS.ports));
  ensureOk(response, 'Unable to fetch serial ports');
  const data = (await response.json()) as { ports: PortOption[] };
  return data.ports ?? [];
};

export const closeSerialPort = async () => {
  const response = await fetch(buildUrl(SERIAL_ENDPOINTS.close), { method: 'POST' });
  ensureOk(response, 'Failed to close serial port');
  return (await response.json()) as SerialStatus;
};

export const openSerialPort = async (port: string, baudrate: number, timeoutMs: number | null) => {
  const response = await fetch(buildUrl(SERIAL_ENDPOINTS.open), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port, baudrate, timeout_ms: timeoutMs }),
  });
  ensureOk(response, 'Failed to open serial port');
  return (await response.json()) as SerialStatus;
};

export const writeSerialHex = async (hexData: string) => {
  const response = await fetch(buildUrl(SERIAL_ENDPOINTS.write), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hex_data: hexData }),
  });
  if (!response.ok) {
    let detail = 'Failed to write to serial port';
    try {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail.trim();
      }
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail);
  }
  const payload = (await response.json()) as { written: number };
  return payload.written;
};

export const writeSerialCommand = async (command: string) => {
  const response = await fetch(buildUrl(SERIAL_ENDPOINTS.write), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  if (!response.ok) {
    let detail = 'Failed to write command to serial port';
    try {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail.trim();
      }
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail);
  }
  const payload = (await response.json()) as { written: number };
  return payload.written;
};

export const getMavlinkParameters = async (timeoutSeconds = 10) => {
  const response = await fetch(
    `${buildUrl(SERIAL_ENDPOINTS.mavlinkParameters)}?timeout_s=${encodeURIComponent(timeoutSeconds)}`
  );
  if (!response.ok) {
    let detail = 'Failed to load MAVLink parameters';
    try {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail.trim();
      }
    } catch {
      // Keep fallback detail.
    }
    throw new Error(detail);
  }
  return (await response.json()) as MavlinkParametersResponse;
};
