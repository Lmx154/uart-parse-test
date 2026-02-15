import { useEffect, useMemo, useRef, useState } from 'react';
import TopNav from './components/TopNav';
import VelocityDisplay from './components/VelocityDisplay';
import AltitudeDisplay from './components/AltitudeDisplay';
import ApogeeDisplay from './components/ApogeeDisplay';
import OrientationDisplay from './components/OrientationDisplay';
import WirelessLink from './components/WirelessLink';
import BatteryDisplay from './components/BatteryDisplay';
import FlightTimeline from './components/FlightTimeline';
import SystemStatus from './components/SystemStatus';
import TerminalPanel from './components/TerminalPanel';
import SettingsPanel from './components/SettingsPanel';
import RealtimeGraphBuilder, { type TelemetrySample } from './components/RealtimeGraphBuilder';
import {
  closeSerialPort,
  getSerialPorts,
  getSerialStatus,
  getTelemetryWebSocketUrl,
  openSerialPort,
  writeSerialHex,
  type PortOption,
  type SerialStatus,
} from './services/api';

const timelineStages = [
  { id: 'launch', label: 'LAUNCH' },
  { id: 'powered-flight', label: 'POWERED FLIGHT' },
  { id: 'burnout', label: 'BURNOUT' },
  { id: 'apogee', label: 'APOGEE' },
  { id: 'free-fall', label: 'FREE FALL' },
  { id: 'drogue-deploy', label: 'DROGUE DEPLOY' },
  { id: 'main-deploy', label: 'MAIN DEPLOY' },
];

type AppTheme = 'dark' | 'light';
type Units = 'metric' | 'imperial';
type TabId = 'dashboard' | 'data' | 'terminal' | 'command' | 'settings';

interface TelemetryState {
  missionTime: number;
  frame: number;
  velocity: number;
  altitude: number;
  apogee: number;
  acceleration: number;
  wireless: number;
  battery: number;
  velocityHistory: number[];
  altitudeHistory: number[];
  sampleHistory: TelemetrySample[];
}

interface TelemetryEvent {
  ts?: number;
  frame?: number;
  packet_name?: string;
  decoded?: string;
  type?: string;
  message?: string;
  parsed?: Record<string, unknown>;
  telemetry?: Record<string, unknown>;
}

const MAX_TERMINAL_LINES = 220;
const BAUDRATE_STORAGE_KEY = 'dashboard-baudrate';
const HISTORY_POINTS_STORAGE_KEY = 'dashboard-history-points';
const DEFAULT_HISTORY_POINT_LIMIT = 10;
const MIN_HISTORY_POINT_LIMIT = 2;
const TELEMETRY_COMMIT_INTERVAL_MS = 50;
const TERMINAL_COMMIT_INTERVAL_MS = 100;

const createInitialTelemetry = (): TelemetryState => ({
  missionTime: 0,
  frame: 0,
  velocity: 0,
  altitude: 0,
  apogee: 0,
  acceleration: 0,
  wireless: 98,
  battery: 88,
  velocityHistory: [0],
  altitudeHistory: [0],
  sampleHistory: [],
});

const mapRssiToPercent = (rssiDbm: number) => {
  const min = -120;
  const max = -40;
  const normalized = ((rssiDbm - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, Math.round(normalized)));
};

const pressureToAltitudeMeters = (pressurePa: number) => {
  const seaLevelPressure = 101325;
  return 44330 * (1 - Math.pow(pressurePa / seaLevelPressure, 0.1903));
};

const extractNumber = (source: string | undefined, key: string) => {
  if (!source) {
    return null;
  }
  const match = source.match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`));
  if (!match) {
    return null;
  }
  return Number(match[1]);
};

const extractNumericField = (source: Record<string, unknown> | undefined, key: string) => {
  if (!source) {
    return null;
  }
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const appendLineInPlace = (lines: string[], line: string) => {
  lines.push(line);
  if (lines.length > MAX_TERMINAL_LINES) {
    lines.splice(0, lines.length - MAX_TERMINAL_LINES);
  }
};

const determineStageIndex = (
  currentStageIndex: number,
  previousVelocity: number,
  velocity: number,
  acceleration: number,
  missionTime: number
) => {
  if (missionTime === 0) {
    return 0;
  }

  if (missionTime > 0 && currentStageIndex < 1) {
    return 1;
  }

  if (currentStageIndex < 2 && acceleration <= 0) {
    return 2;
  }

  if (currentStageIndex < 3 && Math.abs(velocity) <= 1 && previousVelocity > 0) {
    return 3;
  }

  if (currentStageIndex < 4 && velocity < -5) {
    return 4;
  }

  if (currentStageIndex < 5 && previousVelocity < -25 && velocity - previousVelocity >= 20) {
    return 5;
  }

  if (currentStageIndex < 6 && previousVelocity < -20 && velocity - previousVelocity >= 20) {
    return 6;
  }

  return currentStageIndex;
};

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = localStorage.getItem('dashboard-theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [units, setUnits] = useState<Units>(() => {
    const saved = localStorage.getItem('dashboard-units');
    return saved === 'imperial' ? 'imperial' : 'metric';
  });
  const [selectedBaudrate, setSelectedBaudrate] = useState<number>(() => {
    const saved = Number(localStorage.getItem(BAUDRATE_STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : 115200;
  });
  const [historyPointLimit, setHistoryPointLimit] = useState<number>(() => {
    const saved = Number(localStorage.getItem(HISTORY_POINTS_STORAGE_KEY));
    if (!Number.isFinite(saved)) {
      return DEFAULT_HISTORY_POINT_LIMIT;
    }
    return Math.max(MIN_HISTORY_POINT_LIMIT, Math.floor(saved));
  });

  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [telemetry, setTelemetry] = useState<TelemetryState>(createInitialTelemetry);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [ports, setPorts] = useState<PortOption[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [serialStatus, setSerialStatus] = useState<SerialStatus>({
    is_open: false,
    port: null,
    baudrate: null,
    clients: 0,
    frames: 0,
  });
  const [commandHex, setCommandHex] = useState('');

  const missionStartTsRef = useRef<number | null>(null);
  const previousAltitudeRef = useRef<number | null>(null);
  const previousTelemetryTsRef = useRef<number | null>(null);
  const previousVelocityRef = useRef(0);
  const lastTelemetryProcessTsRef = useRef<number | null>(null);
  const lastHistorySampleTsRef = useRef<number | null>(null);
  const historyPointLimitRef = useRef(historyPointLimit);
  const telemetryStateRef = useRef<TelemetryState>(createInitialTelemetry());
  const terminalLinesRef = useRef<string[]>([]);
  const lastTelemetryCommitRef = useRef(0);
  const pendingTelemetryCommitRef = useRef<number | null>(null);
  const lastTerminalCommitRef = useRef(0);
  const pendingTerminalCommitRef = useRef<number | null>(null);

  const commitTelemetryNow = (nextTelemetry: TelemetryState) => {
    if (pendingTelemetryCommitRef.current !== null) {
      window.clearTimeout(pendingTelemetryCommitRef.current);
      pendingTelemetryCommitRef.current = null;
    }
    lastTelemetryCommitRef.current = performance.now();
    setTelemetry(nextTelemetry);
  };

  const scheduleTelemetryCommit = () => {
    const now = performance.now();
    const elapsed = now - lastTelemetryCommitRef.current;
    if (elapsed >= TELEMETRY_COMMIT_INTERVAL_MS) {
      commitTelemetryNow(telemetryStateRef.current);
      return;
    }
    if (pendingTelemetryCommitRef.current !== null) {
      return;
    }
    pendingTelemetryCommitRef.current = window.setTimeout(() => {
      pendingTelemetryCommitRef.current = null;
      commitTelemetryNow(telemetryStateRef.current);
    }, Math.max(0, TELEMETRY_COMMIT_INTERVAL_MS - elapsed));
  };

  const applyTelemetryUpdate = (updater: (previous: TelemetryState) => TelemetryState) => {
    const nextTelemetry = updater(telemetryStateRef.current);
    telemetryStateRef.current = nextTelemetry;
    scheduleTelemetryCommit();
  };

  const commitTerminalNow = () => {
    if (pendingTerminalCommitRef.current !== null) {
      window.clearTimeout(pendingTerminalCommitRef.current);
      pendingTerminalCommitRef.current = null;
    }
    lastTerminalCommitRef.current = performance.now();
    setTerminalLines([...terminalLinesRef.current]);
  };

  const scheduleTerminalCommit = () => {
    const now = performance.now();
    const elapsed = now - lastTerminalCommitRef.current;
    if (elapsed >= TERMINAL_COMMIT_INTERVAL_MS) {
      commitTerminalNow();
      return;
    }
    if (pendingTerminalCommitRef.current !== null) {
      return;
    }
    pendingTerminalCommitRef.current = window.setTimeout(() => {
      pendingTerminalCommitRef.current = null;
      commitTerminalNow();
    }, Math.max(0, TERMINAL_COMMIT_INTERVAL_MS - elapsed));
  };

  const logTerminalLine = (line: string) => {
    appendLineInPlace(terminalLinesRef.current, line);
    scheduleTerminalCommit();
  };

  const clearTerminal = () => {
    if (pendingTerminalCommitRef.current !== null) {
      window.clearTimeout(pendingTerminalCommitRef.current);
      pendingTerminalCommitRef.current = null;
    }
    terminalLinesRef.current = [];
    lastTerminalCommitRef.current = performance.now();
    setTerminalLines([]);
  };

  const distanceUnit = units === 'metric' ? 'm' : 'ft';
  const velocityUnit = units === 'metric' ? 'm/s' : 'ft/s';

  const velocityValue = useMemo(
    () => (units === 'metric' ? telemetry.velocity : telemetry.velocity * 3.28084),
    [telemetry.velocity, units]
  );
  const altitudeValue = useMemo(
    () => (units === 'metric' ? telemetry.altitude : telemetry.altitude * 3.28084),
    [telemetry.altitude, units]
  );
  const apogeeValue = useMemo(
    () => (units === 'metric' ? telemetry.apogee : telemetry.apogee * 3.28084),
    [telemetry.apogee, units]
  );

  useEffect(() => {
    return () => {
      if (pendingTelemetryCommitRef.current !== null) {
        window.clearTimeout(pendingTelemetryCommitRef.current);
      }
      if (pendingTerminalCommitRef.current !== null) {
        window.clearTimeout(pendingTerminalCommitRef.current);
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('dashboard-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('dashboard-units', units);
  }, [units]);

  useEffect(() => {
    localStorage.setItem(BAUDRATE_STORAGE_KEY, String(selectedBaudrate));
  }, [selectedBaudrate]);

  useEffect(() => {
    const normalizedLimit = Math.max(MIN_HISTORY_POINT_LIMIT, Math.floor(historyPointLimit));
    historyPointLimitRef.current = normalizedLimit;
    localStorage.setItem(HISTORY_POINTS_STORAGE_KEY, String(normalizedLimit));
    const trimmedTelemetry: TelemetryState = {
      ...telemetryStateRef.current,
      velocityHistory: telemetryStateRef.current.velocityHistory.slice(-normalizedLimit),
      altitudeHistory: telemetryStateRef.current.altitudeHistory.slice(-normalizedLimit),
      sampleHistory: telemetryStateRef.current.sampleHistory.slice(-normalizedLimit),
    };
    telemetryStateRef.current = trimmedTelemetry;
    commitTelemetryNow(trimmedTelemetry);
  }, [historyPointLimit]);

  useEffect(() => {
    const applyThemeClass = theme === 'dark' ? 'theme-dark' : 'theme-light';
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(applyThemeClass);
    return () => {
      document.body.classList.remove('theme-dark', 'theme-light');
    };
  }, [theme]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await getSerialStatus();
        setSerialStatus(status);
        if (status.port) {
          setSelectedPort(status.port);
        }
        if (status.baudrate) {
          setSelectedBaudrate(status.baudrate);
        }
      } catch {
        logTerminalLine('[status] Unable to fetch serial status');
      }
    };

    const fetchPorts = async () => {
      try {
        const nextPorts = await getSerialPorts();
        setPorts(nextPorts);
        setSelectedPort((currentPort) => currentPort || nextPorts[0]?.value || '');
      } catch {
        logTerminalLine('[ports] Unable to fetch serial ports');
      }
    };

    void fetchStatus();
    void fetchPorts();
  }, []);

  useEffect(() => {
    if (!serialStatus.is_open) {
      setIsStreamConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let pingInterval: number | undefined;
    let reconnectTimeout: number | undefined;
    let stopped = false;

    const clearTimers = () => {
      if (pingInterval) {
        window.clearInterval(pingInterval);
        pingInterval = undefined;
      }
      if (reconnectTimeout) {
        window.clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }
    };

    const connect = () => {
      if (stopped) {
        return;
      }

      ws = new WebSocket(getTelemetryWebSocketUrl());

      ws.onopen = () => {
        if (stopped) {
          return;
        }
        setIsStreamConnected(true);
        setSerialStatus((previous) => ({ ...previous, clients: Math.max(previous.clients, 1) }));
        logTerminalLine('[ws] Connected to telemetry stream');
        ws?.send('subscribe');
        pingInterval = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 15000);
      };

      ws.onclose = () => {
        clearTimers();
        setIsStreamConnected(false);
        setSerialStatus((previous) => ({ ...previous, clients: 0 }));
        if (stopped) {
          return;
        }
        logTerminalLine('[ws] Telemetry stream disconnected, retrying in 2s');
        reconnectTimeout = window.setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        if (!stopped) {
          logTerminalLine('[ws] Telemetry stream error');
        }
      };

      ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data) as TelemetryEvent;
          const timestamp = packet.ts ?? Date.now() / 1000;

          if (missionStartTsRef.current === null) {
            missionStartTsRef.current = timestamp;
          }
          const timeSinceLaunch = Math.max(0, Math.round(timestamp - missionStartTsRef.current));

          if (packet.type === 'error') {
            logTerminalLine(`[error] ${packet.message ?? 'Unknown serial error'}`);
            return;
          }

          const line = `[f${packet.frame ?? '-'}] ${packet.packet_name ?? 'PACKET'} ${packet.decoded ?? ''}`.trim();
          logTerminalLine(line);

          const shouldProcessTelemetry =
            lastTelemetryProcessTsRef.current === null ||
            timestamp - lastTelemetryProcessTsRef.current >= TELEMETRY_COMMIT_INTERVAL_MS / 1000;
          if (!shouldProcessTelemetry) {
            return;
          }
          lastTelemetryProcessTsRef.current = timestamp;

          const telemetryFields = packet.telemetry;
          const nextBatteryMv =
            extractNumericField(telemetryFields, 'battery_mv') ?? extractNumber(packet.decoded, 'vbat_mv');
          const uplinkRssi =
            extractNumericField(telemetryFields, 'rssi_uplink_dbm') ?? extractNumber(packet.decoded, 'rssi_uplink');
          const gpsAltitudeMeters = extractNumericField(telemetryFields, 'alt_m');
          const gpsAltitudeMm = extractNumericField(telemetryFields, 'alt_mm') ?? extractNumber(packet.decoded, 'alt_mm');
          const pressurePa =
            extractNumericField(telemetryFields, 'pressure_pa') ?? extractNumber(packet.decoded, 'pressure_pa');
          const parsedBattery =
            nextBatteryMv !== null
              ? Math.max(0, Math.min(100, Math.round(((nextBatteryMv - 3300) / 900) * 100)))
              : null;
          const parsedWireless = uplinkRssi !== null ? mapRssiToPercent(uplinkRssi) : null;

          let resolvedAltitude: number | null = null;
          if (gpsAltitudeMeters !== null) {
            resolvedAltitude = gpsAltitudeMeters;
          } else if (gpsAltitudeMm !== null) {
            resolvedAltitude = gpsAltitudeMm / 1000;
          } else if (pressurePa !== null) {
            resolvedAltitude = pressureToAltitudeMeters(pressurePa);
          }

          let resolvedVelocity = previousVelocityRef.current;
          let resolvedAcceleration = 0;

          if (
            resolvedAltitude !== null &&
            previousAltitudeRef.current !== null &&
            previousTelemetryTsRef.current !== null
          ) {
            const dt = timestamp - previousTelemetryTsRef.current;
            if (dt > 0) {
              resolvedVelocity = (resolvedAltitude - previousAltitudeRef.current) / dt;
              resolvedAcceleration = (resolvedVelocity - previousVelocityRef.current) / dt;
            }
          }

          setCurrentStageIndex((stage) =>
            determineStageIndex(stage, previousVelocityRef.current, resolvedVelocity, resolvedAcceleration, timeSinceLaunch)
          );

          previousTelemetryTsRef.current = timestamp;
          if (resolvedAltitude !== null) {
            previousAltitudeRef.current = resolvedAltitude;
          }
          previousVelocityRef.current = resolvedVelocity;

          applyTelemetryUpdate((previousTelemetry) => {
            const historyLimit = Math.max(MIN_HISTORY_POINT_LIMIT, historyPointLimitRef.current);
            const nextAltitude = resolvedAltitude ?? previousTelemetry.altitude;
            const nextFrame = packet.frame ?? previousTelemetry.frame + 1;
            const nextBattery = parsedBattery ?? previousTelemetry.battery;
            const nextWireless = parsedWireless ?? previousTelemetry.wireless;
            const nextApogee = Math.max(previousTelemetry.apogee, nextAltitude);
            const previousSample = previousTelemetry.sampleHistory[previousTelemetry.sampleHistory.length - 1];
            const shouldAppendSample =
              lastHistorySampleTsRef.current === null ||
              timestamp - lastHistorySampleTsRef.current >= TELEMETRY_COMMIT_INTERVAL_MS / 1000;
            if (shouldAppendSample) {
              lastHistorySampleTsRef.current = timestamp;
            }

            const nextAccelX = extractNumericField(telemetryFields, 'accel_x') ?? previousSample?.accelX ?? null;
            const nextAccelY = extractNumericField(telemetryFields, 'accel_y') ?? previousSample?.accelY ?? null;
            const nextAccelZ = extractNumericField(telemetryFields, 'accel_z') ?? previousSample?.accelZ ?? null;
            const nextGyroX = extractNumericField(telemetryFields, 'gyro_x') ?? previousSample?.gyroX ?? null;
            const nextGyroY = extractNumericField(telemetryFields, 'gyro_y') ?? previousSample?.gyroY ?? null;
            const nextGyroZ = extractNumericField(telemetryFields, 'gyro_z') ?? previousSample?.gyroZ ?? null;
            const nextMagX = extractNumericField(telemetryFields, 'mag_x') ?? previousSample?.magX ?? null;
            const nextMagY = extractNumericField(telemetryFields, 'mag_y') ?? previousSample?.magY ?? null;
            const nextMagZ = extractNumericField(telemetryFields, 'mag_z') ?? previousSample?.magZ ?? null;
            const nextPressurePa =
              extractNumericField(telemetryFields, 'pressure_pa') ?? previousSample?.pressurePa ?? null;
            const nextTempC =
              extractNumericField(telemetryFields, 'temp_c') ??
              extractNumericField(telemetryFields, 'system_temp_c') ??
              previousSample?.tempC ??
              null;
            const nextLatDeg = extractNumericField(telemetryFields, 'lat_deg') ?? previousSample?.latDeg ?? null;
            const nextLonDeg = extractNumericField(telemetryFields, 'lon_deg') ?? previousSample?.lonDeg ?? null;

            const nextSample = {
              missionTime: timeSinceLaunch,
              frame: nextFrame,
              velocity: resolvedVelocity,
              altitude: nextAltitude,
              apogee: nextApogee,
              acceleration: resolvedAcceleration,
              battery: nextBattery,
              wireless: nextWireless,
              accelX: nextAccelX,
              accelY: nextAccelY,
              accelZ: nextAccelZ,
              gyroX: nextGyroX,
              gyroY: nextGyroY,
              gyroZ: nextGyroZ,
              magX: nextMagX,
              magY: nextMagY,
              magZ: nextMagZ,
              pressurePa: nextPressurePa,
              tempC: nextTempC,
              latDeg: nextLatDeg,
              lonDeg: nextLonDeg,
            };

            const nextVelocityHistory = shouldAppendSample
              ? [...previousTelemetry.velocityHistory, resolvedVelocity].slice(-historyLimit)
              : previousTelemetry.velocityHistory;
            const nextAltitudeHistory = shouldAppendSample
              ? [...previousTelemetry.altitudeHistory, nextAltitude].slice(-historyLimit)
              : previousTelemetry.altitudeHistory;
            const nextSampleHistory = shouldAppendSample
              ? [...previousTelemetry.sampleHistory, nextSample].slice(-historyLimit)
              : previousTelemetry.sampleHistory;

            return {
              missionTime: timeSinceLaunch,
              frame: nextFrame,
              velocity: resolvedVelocity,
              altitude: nextAltitude,
              apogee: nextApogee,
              acceleration: resolvedAcceleration,
              wireless: nextWireless,
              battery: nextBattery,
              velocityHistory: nextVelocityHistory,
              altitudeHistory: nextAltitudeHistory,
              sampleHistory: nextSampleHistory,
            };
          });

        } catch {
          logTerminalLine('[ws] Failed to parse telemetry message');
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimers();
      if (ws) {
        ws.close();
        ws = null;
      }
      setIsStreamConnected(false);
    };
  }, [serialStatus.is_open]);

  const refreshPorts = async () => {
    try {
      const nextPorts = await getSerialPorts();
      setPorts(nextPorts);
      setSelectedPort((currentPort) => currentPort || nextPorts[0]?.value || '');
      logTerminalLine(`[ports] ${nextPorts.length} port(s) found`);
    } catch {
      logTerminalLine('[ports] Failed to refresh serial ports');
    }
  };

  const resetTelemetrySession = () => {
    missionStartTsRef.current = null;
    previousAltitudeRef.current = null;
    previousTelemetryTsRef.current = null;
    previousVelocityRef.current = 0;
    lastTelemetryProcessTsRef.current = null;
    lastHistorySampleTsRef.current = null;
    setCurrentStageIndex(0);
    const nextTelemetry = createInitialTelemetry();
    telemetryStateRef.current = nextTelemetry;
    commitTelemetryNow(nextTelemetry);
  };

  const handleHistoryPointLimitChange = (points: number) => {
    if (!Number.isFinite(points)) {
      setHistoryPointLimit(DEFAULT_HISTORY_POINT_LIMIT);
      return;
    }
    setHistoryPointLimit(Math.max(MIN_HISTORY_POINT_LIMIT, Math.floor(points)));
  };

  const toggleSerialConnection = async () => {
    try {
      setConnectionBusy(true);
      if (serialStatus.is_open) {
        const status = await closeSerialPort();
        setSerialStatus(status);
        logTerminalLine('[serial] Port closed');
        return;
      }

      const status = await openSerialPort(selectedPort, selectedBaudrate);
      setSerialStatus(status);
      if (status.baudrate) {
        setSelectedBaudrate(status.baudrate);
      }
      resetTelemetrySession();
      logTerminalLine(`[serial] Opened ${status.port ?? selectedPort} @ ${status.baudrate ?? selectedBaudrate}`);
    } catch {
      logTerminalLine('[serial] Failed to change serial connection');
    } finally {
      setConnectionBusy(false);
    }
  };

  const sendCommand = async () => {
    if (!commandHex.trim()) {
      return;
    }

    try {
      const written = await writeSerialHex(commandHex);
      logTerminalLine(`[tx] ${written} bytes -> ${commandHex}`);
      setCommandHex('');
    } catch {
      logTerminalLine('[tx] Failed to send command');
    }
  };

  return (
    <div
      className={`min-h-screen overflow-hidden relative transition-colors ${
        theme === 'dark' ? 'bg-black text-white' : 'bg-gray-100 text-gray-900'
      }`}
    >
      <div
        className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-30'}`}
        style={{
          backgroundImage: `
            linear-gradient(rgba(249, 115, 22, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(249, 115, 22, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      <TopNav activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab as TabId)} />

      <div className="relative z-10 pt-32 px-8 pb-8">
        {activeTab === 'dashboard' && (
          <div className="max-w-[1800px] mx-auto space-y-8">
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-3 space-y-6">
                <VelocityDisplay velocity={velocityValue} unit={velocityUnit} data={telemetry.velocityHistory} />
                <OrientationDisplay />
                <WirelessLink strength={telemetry.wireless} />
                <BatteryDisplay level={telemetry.battery} />
              </div>

              <div className="col-span-6 flex items-center justify-center">
                <div className="w-full border border-orange-500/40 rounded-lg p-6 bg-black/40 backdrop-blur-sm h-[420px] flex flex-col justify-between">
                  <div>
                    <div className="text-gray-400 text-xs tracking-widest mb-3">LIVE FLIGHT FEED</div>
                    <div className="text-3xl font-bold tracking-wider mb-2">
                      {isStreamConnected ? 'TELEMETRY ONLINE' : 'WAITING FOR STREAM'}
                    </div>
                    <div className="text-sm text-gray-400">
                      Serial: {serialStatus.is_open ? `${serialStatus.port ?? 'OPEN'}` : 'CLOSED'}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="border border-orange-500/30 rounded p-3">
                      <div className="text-xs text-gray-400 tracking-wider">FRAMES</div>
                      <div className="text-2xl font-bold">{telemetry.frame}</div>
                    </div>
                    <div className="border border-orange-500/30 rounded p-3">
                      <div className="text-xs text-gray-400 tracking-wider">CLIENTS</div>
                      <div className="text-2xl font-bold">{serialStatus.clients}</div>
                    </div>
                    <div className="border border-orange-500/30 rounded p-3">
                      <div className="text-xs text-gray-400 tracking-wider">UNITS</div>
                      <div className="text-2xl font-bold uppercase">{units}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-span-3 space-y-6">
                <AltitudeDisplay altitude={altitudeValue} unit={distanceUnit} data={telemetry.altitudeHistory} />
                <ApogeeDisplay apogee={apogeeValue} unit={distanceUnit} data={telemetry.altitudeHistory} />
                <SystemStatus
                  primaryStatus={serialStatus.is_open ? 'LINK OPEN' : 'STANDBY'}
                  secondaryStatus={isStreamConnected ? 'STREAMING' : 'NO STREAM'}
                />
              </div>
            </div>

            <div>
              <FlightTimeline
                currentTime={telemetry.missionTime}
                currentStageIndex={currentStageIndex}
                stages={timelineStages}
              />
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <RealtimeGraphBuilder
            samples={telemetry.sampleHistory}
            units={units}
            isStreamConnected={isStreamConnected}
          />
        )}

        {activeTab === 'terminal' && (
          <div className="max-w-[1800px] mx-auto">
            <TerminalPanel lines={terminalLines} onClear={clearTerminal} />
          </div>
        )}

        {activeTab === 'command' && (
          <div className="max-w-[1800px] mx-auto">
            <div className="border border-orange-500/40 rounded-lg p-6 bg-black/40 backdrop-blur-sm">
              <div className="text-gray-400 text-xs tracking-widest mb-3">COMMAND CONSOLE</div>
              <div className="flex items-center gap-3">
                <input
                  value={commandHex}
                  onChange={(event) => setCommandHex(event.target.value)}
                  placeholder="Enter hex command (example: A55A0201ABCD)"
                  className="flex-1 bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={sendCommand}
                  className="px-4 py-2 text-xs font-semibold tracking-wider rounded border border-orange-500 text-orange-500 hover:bg-orange-500/20 transition-colors"
                >
                  SEND
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-3">Commands require an open serial port.</div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-[1800px] mx-auto">
            <SettingsPanel
              theme={theme}
              units={units}
              ports={ports}
              selectedPort={selectedPort}
              selectedBaudrate={selectedBaudrate}
              historyPointLimit={historyPointLimit}
              isOpen={serialStatus.is_open}
              isBusy={connectionBusy}
              onThemeChange={setTheme}
              onUnitsChange={setUnits}
              onPortChange={setSelectedPort}
              onBaudrateChange={setSelectedBaudrate}
              onHistoryPointLimitChange={handleHistoryPointLimitChange}
              onRefreshPorts={refreshPorts}
              onToggleConnection={toggleSerialConnection}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
