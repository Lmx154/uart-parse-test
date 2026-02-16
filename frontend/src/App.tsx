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
import ParametersPanel from './components/ParametersPanel';
import {
  closeSerialPort,
  getMavlinkParameters,
  getSerialPorts,
  getSerialStatus,
  getTelemetryWebSocketUrl,
  openSerialPort,
  writeSerialCommand,
  type MavlinkParameter,
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
type VehicleType = 'rocket' | 'drone';
type DeviceType = 'gs' | 'fc';
type VelocitySource = 'baro' | 'imu_z_instant';
type TabId = 'dashboard' | 'data' | 'parameters' | 'terminal' | 'command' | 'settings';

interface DiagnosticsSnapshot {
  wsPacketsPerSec: number;
  telemetryProcessedPerSec: number;
  telemetryCommitsPerSec: number;
  terminalCommitsPerSec: number;
  terminalBufferedLines: number;
  terminalPacketLogsDroppedPerSec: number;
  msSinceLastPacket: number | null;
  backendQueueDepth: number;
  backendQueueDropped: number;
}

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
  detail?: string;
  parsed?: Record<string, unknown>;
  telemetry?: Record<string, unknown>;
  queue_depth?: number;
  queue_dropped?: number;
}

const MAX_TERMINAL_LINES = 220;
const DEVICE_TYPE_STORAGE_KEY = 'dashboard-device-type';
const VEHICLE_TYPE_STORAGE_KEY = 'dashboard-vehicle-type';
const BAUDRATE_STORAGE_KEY = 'dashboard-baudrate';
const SERIAL_TIMEOUT_STORAGE_KEY = 'dashboard-serial-timeout-ms';
const HISTORY_POINTS_STORAGE_KEY = 'dashboard-history-points';
const PROCESS_TELEMETRY_UI_STORAGE_KEY = 'dashboard-process-telemetry-ui';
const RENDER_DATALAB_CHARTS_STORAGE_KEY = 'dashboard-render-datalab-charts';
const TERMINAL_PACKET_LOGGING_STORAGE_KEY = 'dashboard-terminal-packet-logging';
const DEFAULT_HISTORY_POINT_LIMIT = 10;
const MIN_HISTORY_POINT_LIMIT = 2;
const TELEMETRY_COMMIT_INTERVAL_MS = 20;
const TERMINAL_COMMIT_INTERVAL_MS = 100;
const TERMINAL_PACKET_LOG_LIMIT_PER_SEC = 15;
const GS_COMMANDS = ['ARM', 'DISARM', 'RTL', 'HOLD'] as const;
const VELOCITY_SOURCE: VelocitySource = 'imu_z_instant';
const BMI088_ACCEL_COUNTS_PER_G = 5460;
const GRAVITY_MPS2 = 9.80665;
const IMU_GRAVITY_CALIBRATION_SAMPLE_COUNT = 12;
const IMU_ACCEL_DEADBAND_MPS2 = 0.15;
const IMU_INSTANT_VELOCITY_TAU_S = 0.35;

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

const normalizeGsCommand = (input: string) => input.trim().toUpperCase();

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
  const [deviceType, setDeviceType] = useState<DeviceType>(() => {
    const saved = localStorage.getItem(DEVICE_TYPE_STORAGE_KEY);
    return saved === 'fc' ? 'fc' : 'gs';
  });
  const [vehicleType, setVehicleType] = useState<VehicleType>(() => {
    const saved = localStorage.getItem(VEHICLE_TYPE_STORAGE_KEY);
    return saved === 'drone' ? 'drone' : 'rocket';
  });
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
  const [selectedSerialTimeoutMs, setSelectedSerialTimeoutMs] = useState<number | null>(() => {
    const saved = localStorage.getItem(SERIAL_TIMEOUT_STORAGE_KEY);
    if (!saved || saved === 'none') {
      return null;
    }
    const parsed = Number(saved);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  });
  const [historyPointLimit, setHistoryPointLimit] = useState<number>(() => {
    const saved = Number(localStorage.getItem(HISTORY_POINTS_STORAGE_KEY));
    if (!Number.isFinite(saved)) {
      return DEFAULT_HISTORY_POINT_LIMIT;
    }
    return Math.max(MIN_HISTORY_POINT_LIMIT, Math.floor(saved));
  });
  const [processTelemetryUi, setProcessTelemetryUi] = useState(() => {
    const saved = localStorage.getItem(PROCESS_TELEMETRY_UI_STORAGE_KEY);
    return saved !== 'false';
  });
  const [renderDataLabCharts, setRenderDataLabCharts] = useState(() => {
    const saved = localStorage.getItem(RENDER_DATALAB_CHARTS_STORAGE_KEY);
    return saved !== 'false';
  });
  const [terminalPacketLoggingEnabled, setTerminalPacketLoggingEnabled] = useState(() => {
    const saved = localStorage.getItem(TERMINAL_PACKET_LOGGING_STORAGE_KEY);
    return saved !== 'false';
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
  const [parameters, setParameters] = useState<MavlinkParameter[]>([]);
  const [parametersLoading, setParametersLoading] = useState(false);
  const [parametersError, setParametersError] = useState<string | null>(null);
  const [parametersExpected, setParametersExpected] = useState<number | null>(null);
  const [parametersElapsedMs, setParametersElapsedMs] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>({
    wsPacketsPerSec: 0,
    telemetryProcessedPerSec: 0,
    telemetryCommitsPerSec: 0,
    terminalCommitsPerSec: 0,
    terminalBufferedLines: 0,
    terminalPacketLogsDroppedPerSec: 0,
    msSinceLastPacket: null,
    backendQueueDepth: 0,
    backendQueueDropped: 0,
  });

  const missionStartTsRef = useRef<number | null>(null);
  const previousAltitudeRef = useRef<number | null>(null);
  const previousVelocityTsRef = useRef<number | null>(null);
  const previousVelocityRef = useRef(0);
  const latestAccelZRawRef = useRef<number | null>(null);
  const imuGravityRefRawRef = useRef<number | null>(null);
  const imuGravityCalibSumRef = useRef(0);
  const imuGravityCalibCountRef = useRef(0);
  const lastTelemetryProcessTsRef = useRef<number | null>(null);
  const lastHistorySampleTsRef = useRef<number | null>(null);
  const historyPointLimitRef = useRef(historyPointLimit);
  const telemetryStateRef = useRef<TelemetryState>(createInitialTelemetry());
  const terminalLinesRef = useRef<string[]>([]);
  const lastTelemetryCommitRef = useRef(0);
  const pendingTelemetryCommitRef = useRef<number | null>(null);
  const lastTerminalCommitRef = useRef(0);
  const pendingTerminalCommitRef = useRef<number | null>(null);
  const activeTabRef = useRef<TabId>(activeTab);
  const processTelemetryUiRef = useRef(processTelemetryUi);
  const terminalPacketLoggingEnabledRef = useRef(terminalPacketLoggingEnabled);
  const wsPacketsTotalRef = useRef(0);
  const telemetryProcessedTotalRef = useRef(0);
  const telemetryCommitsTotalRef = useRef(0);
  const terminalCommitsTotalRef = useRef(0);
  const terminalPacketLogsDroppedTotalRef = useRef(0);
  const lastWsPacketPerfTsRef = useRef<number | null>(null);
  const terminalPacketLogWindowStartRef = useRef<number>(performance.now());
  const terminalPacketLogCountRef = useRef(0);
  const backendQueueDepthRef = useRef(0);
  const backendQueueDroppedRef = useRef(0);

  const commitTelemetryNow = (nextTelemetry: TelemetryState) => {
    if (pendingTelemetryCommitRef.current !== null) {
      window.clearTimeout(pendingTelemetryCommitRef.current);
      pendingTelemetryCommitRef.current = null;
    }
    lastTelemetryCommitRef.current = performance.now();
    telemetryCommitsTotalRef.current += 1;
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
    if (activeTabRef.current !== 'terminal') {
      return;
    }
    terminalCommitsTotalRef.current += 1;
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
    if (activeTabRef.current !== 'terminal') {
      return;
    }
    scheduleTerminalCommit();
  };

  const logPacketLine = (line: string) => {
    if (!terminalPacketLoggingEnabledRef.current) {
      return;
    }

    const now = performance.now();
    if (now - terminalPacketLogWindowStartRef.current >= 1000) {
      terminalPacketLogWindowStartRef.current = now;
      terminalPacketLogCountRef.current = 0;
    }

    if (terminalPacketLogCountRef.current < TERMINAL_PACKET_LOG_LIMIT_PER_SEC) {
      terminalPacketLogCountRef.current += 1;
      logTerminalLine(line);
      return;
    }

    terminalPacketLogsDroppedTotalRef.current += 1;
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
    localStorage.setItem(DEVICE_TYPE_STORAGE_KEY, deviceType);
  }, [deviceType]);

  useEffect(() => {
    localStorage.setItem(VEHICLE_TYPE_STORAGE_KEY, vehicleType);
  }, [vehicleType]);

  useEffect(() => {
    if (deviceType !== 'fc') {
      setParameters([]);
      setParametersExpected(null);
      setParametersElapsedMs(null);
      setParametersError(null);
      if (activeTab === 'parameters') {
        setActiveTab('dashboard');
      }
    }
  }, [deviceType, activeTab]);

  useEffect(() => {
    localStorage.setItem('dashboard-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('dashboard-units', units);
  }, [units]);

  useEffect(() => {
    activeTabRef.current = activeTab;
    if (activeTab !== 'terminal') {
      return;
    }
    terminalCommitsTotalRef.current += 1;
    setTerminalLines([...terminalLinesRef.current]);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem(BAUDRATE_STORAGE_KEY, String(selectedBaudrate));
  }, [selectedBaudrate]);

  useEffect(() => {
    localStorage.setItem(
      SERIAL_TIMEOUT_STORAGE_KEY,
      selectedSerialTimeoutMs === null ? 'none' : String(selectedSerialTimeoutMs)
    );
  }, [selectedSerialTimeoutMs]);

  useEffect(() => {
    localStorage.setItem(PROCESS_TELEMETRY_UI_STORAGE_KEY, String(processTelemetryUi));
    processTelemetryUiRef.current = processTelemetryUi;
  }, [processTelemetryUi]);

  useEffect(() => {
    localStorage.setItem(RENDER_DATALAB_CHARTS_STORAGE_KEY, String(renderDataLabCharts));
  }, [renderDataLabCharts]);

  useEffect(() => {
    localStorage.setItem(TERMINAL_PACKET_LOGGING_STORAGE_KEY, String(terminalPacketLoggingEnabled));
    terminalPacketLoggingEnabledRef.current = terminalPacketLoggingEnabled;
  }, [terminalPacketLoggingEnabled]);

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
    let previousWsPackets = wsPacketsTotalRef.current;
    let previousTelemetryProcessed = telemetryProcessedTotalRef.current;
    let previousTelemetryCommits = telemetryCommitsTotalRef.current;
    let previousTerminalCommits = terminalCommitsTotalRef.current;
    let previousTerminalPacketLogsDropped = terminalPacketLogsDroppedTotalRef.current;

    const interval = window.setInterval(() => {
      const wsPackets = wsPacketsTotalRef.current;
      const telemetryProcessed = telemetryProcessedTotalRef.current;
      const telemetryCommits = telemetryCommitsTotalRef.current;
      const terminalCommits = terminalCommitsTotalRef.current;
      const now = performance.now();
      const lastPacketTs = lastWsPacketPerfTsRef.current;

      setDiagnostics({
        wsPacketsPerSec: wsPackets - previousWsPackets,
        telemetryProcessedPerSec: telemetryProcessed - previousTelemetryProcessed,
        telemetryCommitsPerSec: telemetryCommits - previousTelemetryCommits,
        terminalCommitsPerSec: terminalCommits - previousTerminalCommits,
        terminalBufferedLines: terminalLinesRef.current.length,
        terminalPacketLogsDroppedPerSec: terminalPacketLogsDroppedTotalRef.current - previousTerminalPacketLogsDropped,
        msSinceLastPacket: lastPacketTs === null ? null : Math.round(now - lastPacketTs),
        backendQueueDepth: backendQueueDepthRef.current,
        backendQueueDropped: backendQueueDroppedRef.current,
      });

      previousWsPackets = wsPackets;
      previousTelemetryProcessed = telemetryProcessed;
      previousTelemetryCommits = telemetryCommits;
      previousTerminalCommits = terminalCommits;
      previousTerminalPacketLogsDropped = terminalPacketLogsDroppedTotalRef.current;
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

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
        if (typeof status.timeout_ms === 'number' && Number.isFinite(status.timeout_ms) && status.timeout_ms > 0) {
          setSelectedSerialTimeoutMs(Math.floor(status.timeout_ms));
        } else if (status.timeout_ms === null) {
          setSelectedSerialTimeoutMs(null);
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
          wsPacketsTotalRef.current += 1;
          lastWsPacketPerfTsRef.current = performance.now();
          if (typeof packet.queue_depth === 'number' && Number.isFinite(packet.queue_depth)) {
            backendQueueDepthRef.current = Math.max(0, Math.floor(packet.queue_depth));
          }
          if (typeof packet.queue_dropped === 'number' && Number.isFinite(packet.queue_dropped)) {
            backendQueueDroppedRef.current = Math.max(0, Math.floor(packet.queue_dropped));
          }

          if (missionStartTsRef.current === null) {
            missionStartTsRef.current = timestamp;
          }
          const timeSinceLaunch = Math.max(0, timestamp - missionStartTsRef.current);

          if (packet.type === 'error') {
            logTerminalLine(`[error] ${packet.message ?? 'Unknown serial error'}`);
            if (packet.detail) {
              logTerminalLine(`[error-detail] ${packet.detail}`);
            }
            return;
          }

          const line = `[f${packet.frame ?? '-'}] ${packet.packet_name ?? 'PACKET'} ${packet.decoded ?? ''}`.trim();
          logPacketLine(line);

          const telemetryFields = packet.telemetry;
          const latestAccelZRaw = extractNumericField(telemetryFields, 'accel_z');
          if (latestAccelZRaw !== null) {
            latestAccelZRawRef.current = latestAccelZRaw;
          }

          const shouldProcessTelemetry =
            lastTelemetryProcessTsRef.current === null ||
            timestamp - lastTelemetryProcessTsRef.current >= TELEMETRY_COMMIT_INTERVAL_MS / 1000;
          if (!shouldProcessTelemetry) {
            return;
          }
          if (!processTelemetryUiRef.current) {
            return;
          }
          lastTelemetryProcessTsRef.current = timestamp;
          telemetryProcessedTotalRef.current += 1;

          const nextBatteryMv =
            extractNumericField(telemetryFields, 'battery_mv') ?? extractNumber(packet.decoded, 'vbat_mv');
          const uplinkRssi =
            extractNumericField(telemetryFields, 'rssi_uplink_dbm') ?? extractNumber(packet.decoded, 'rssi_uplink');
          const pressurePa =
            extractNumericField(telemetryFields, 'pressure_pa') ?? extractNumber(packet.decoded, 'pressure_pa');
          const parsedBattery =
            nextBatteryMv !== null
              ? Math.max(0, Math.min(100, Math.round(((nextBatteryMv - 3300) / 900) * 100)))
              : null;
          const parsedWireless = uplinkRssi !== null ? mapRssiToPercent(uplinkRssi) : null;

          let resolvedAltitude: number | null = null;
          if (pressurePa !== null) {
            const fromPressure = pressureToAltitudeMeters(pressurePa);
            resolvedAltitude = Number.isFinite(fromPressure) ? fromPressure : null;
          }

          let resolvedVelocity = previousVelocityRef.current;
          let resolvedAcceleration = 0;
          const previousVelocity = previousVelocityRef.current;
          const velocityDt = previousVelocityTsRef.current === null ? null : timestamp - previousVelocityTsRef.current;

          if (VELOCITY_SOURCE === 'imu_z_instant') {
            const accelZRaw = latestAccelZRawRef.current;
            if (accelZRaw !== null) {
              if (
                imuGravityRefRawRef.current === null &&
                imuGravityCalibCountRef.current < IMU_GRAVITY_CALIBRATION_SAMPLE_COUNT
              ) {
                imuGravityCalibSumRef.current += accelZRaw;
                imuGravityCalibCountRef.current += 1;
                if (imuGravityCalibCountRef.current >= IMU_GRAVITY_CALIBRATION_SAMPLE_COUNT) {
                  imuGravityRefRawRef.current = imuGravityCalibSumRef.current / imuGravityCalibCountRef.current;
                }
              }

              const gravityRefRaw = imuGravityRefRawRef.current;
              if (gravityRefRaw !== null) {
                let netAccelMps2 = ((accelZRaw - gravityRefRaw) / BMI088_ACCEL_COUNTS_PER_G) * GRAVITY_MPS2;
                if (Math.abs(netAccelMps2) < IMU_ACCEL_DEADBAND_MPS2) {
                  netAccelMps2 = 0;
                }

                resolvedAcceleration = netAccelMps2;
                const instantVelocity = netAccelMps2 * IMU_INSTANT_VELOCITY_TAU_S;
                if (Number.isFinite(instantVelocity)) {
                  resolvedVelocity = instantVelocity;
                }

                if (Math.abs(netAccelMps2) < IMU_ACCEL_DEADBAND_MPS2 * 0.5) {
                  imuGravityRefRawRef.current = gravityRefRaw * 0.995 + accelZRaw * 0.005;
                }
              }
            }
          } else if (
            resolvedAltitude !== null &&
            previousAltitudeRef.current !== null &&
            velocityDt !== null &&
            velocityDt > 0
          ) {
            const rawVelocity = (resolvedAltitude - previousAltitudeRef.current) / velocityDt;
            if (Number.isFinite(rawVelocity)) {
              resolvedVelocity = rawVelocity;
            }
            resolvedAcceleration = (resolvedVelocity - previousVelocity) / velocityDt;
          }

          setCurrentStageIndex((stage) =>
            determineStageIndex(stage, previousVelocityRef.current, resolvedVelocity, resolvedAcceleration, timeSinceLaunch)
          );

          if (resolvedAltitude !== null) {
            previousAltitudeRef.current = resolvedAltitude;
          }
          if (VELOCITY_SOURCE === 'imu_z_instant') {
            previousVelocityTsRef.current = timestamp;
          } else if (resolvedAltitude !== null) {
            previousVelocityTsRef.current = timestamp;
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
    previousVelocityTsRef.current = null;
    previousVelocityRef.current = 0;
    latestAccelZRawRef.current = null;
    imuGravityRefRawRef.current = null;
    imuGravityCalibSumRef.current = 0;
    imuGravityCalibCountRef.current = 0;
    lastTelemetryProcessTsRef.current = null;
    lastHistorySampleTsRef.current = null;
    terminalPacketLogWindowStartRef.current = performance.now();
    terminalPacketLogCountRef.current = 0;
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

      const status = await openSerialPort(selectedPort, selectedBaudrate, selectedSerialTimeoutMs);
      setSerialStatus(status);
      if (status.baudrate) {
        setSelectedBaudrate(status.baudrate);
      }
      if (typeof status.timeout_ms === 'number' && Number.isFinite(status.timeout_ms) && status.timeout_ms > 0) {
        setSelectedSerialTimeoutMs(Math.floor(status.timeout_ms));
      } else if (status.timeout_ms === null) {
        setSelectedSerialTimeoutMs(null);
      }
      resetTelemetrySession();
      const timeoutLabel =
        status.timeout_ms === null || status.timeout_ms === undefined
          ? 'timeout=never'
          : `timeout=${status.timeout_ms}ms`;
      logTerminalLine(
        `[serial] Opened ${status.port ?? selectedPort} @ ${status.baudrate ?? selectedBaudrate} (${timeoutLabel})`
      );
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

    const normalizedCommand = normalizeGsCommand(commandHex);
    if (!normalizedCommand) {
      logTerminalLine('[tx] Command is empty');
      return;
    }
    if (!(GS_COMMANDS as readonly string[]).includes(normalizedCommand)) {
      logTerminalLine('[tx] Invalid command. Use ARM, DISARM, RTL, or HOLD');
      return;
    }

    try {
      const written = await writeSerialCommand(normalizedCommand);
      logTerminalLine(`[tx] ${written} bytes -> ${normalizedCommand}`);
      setCommandHex('');
    } catch (error) {
      if (error instanceof Error && error.message) {
        logTerminalLine(`[tx] Failed: ${error.message}`);
      } else {
        logTerminalLine('[tx] Failed to send command');
      }
    }
  };

  const loadParameters = async () => {
    if (deviceType !== 'fc') {
      setParametersError('Set device to FC to load parameters.');
      return;
    }
    if (!serialStatus.is_open) {
      setParametersError('Open the serial link before loading parameters.');
      return;
    }

    try {
      setParametersLoading(true);
      setParametersError(null);
      const payload = await getMavlinkParameters(12);
      setParameters(payload.parameters);
      setParametersExpected(payload.expected);
      setParametersElapsedMs(payload.elapsed_ms);
      logTerminalLine(`[params] Loaded ${payload.received}${payload.expected === null ? '' : `/${payload.expected}`}`);
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : 'Failed to load MAVLink parameters';
      setParametersError(detail);
      logTerminalLine(`[params] ${detail}`);
    } finally {
      setParametersLoading(false);
    }
  };

  useEffect(() => {
    if (deviceType !== 'fc' || activeTab !== 'parameters') {
      return;
    }
    if (parameters.length > 0 || parametersLoading) {
      return;
    }
    void loadParameters();
  }, [deviceType, activeTab, serialStatus.is_open]);

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

      <TopNav activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab as TabId)} deviceType={deviceType} />

      <div className="relative z-10 pt-32 px-8 pb-8">
        {activeTab === 'dashboard' && (
          <div className="max-w-[1800px] mx-auto space-y-8">
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-3 space-y-6">
                <VelocityDisplay velocity={velocityValue} unit={velocityUnit} data={telemetry.velocityHistory} />
                <OrientationDisplay
                  gyroX={telemetry.sampleHistory[telemetry.sampleHistory.length - 1]?.gyroX ?? null}
                  gyroY={telemetry.sampleHistory[telemetry.sampleHistory.length - 1]?.gyroY ?? null}
                  gyroZ={telemetry.sampleHistory[telemetry.sampleHistory.length - 1]?.gyroZ ?? null}
                />
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
                {vehicleType === 'rocket' ? (
                  <ApogeeDisplay apogee={apogeeValue} unit={distanceUnit} data={telemetry.altitudeHistory} />
                ) : null}
                <SystemStatus
                  primaryStatus={serialStatus.is_open ? 'LINK OPEN' : 'STANDBY'}
                  secondaryStatus={isStreamConnected ? 'STREAMING' : 'NO STREAM'}
                />
              </div>
            </div>

            {vehicleType === 'rocket' ? (
              <div>
                <FlightTimeline
                  currentTime={telemetry.missionTime}
                  currentStageIndex={currentStageIndex}
                  stages={timelineStages}
                />
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'data' &&
          (renderDataLabCharts ? (
            <div className="max-w-[1800px] mx-auto space-y-4">
              {!processTelemetryUi && (
                <div className="border border-amber-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
                  <div className="text-[11px] text-amber-400 tracking-widest mb-1">DATA LAB PAUSED</div>
                  <div className="text-sm text-gray-300">
                    `Process telemetry for UI` is disabled, so live chart samples are intentionally not updating.
                  </div>
                </div>
              )}
              <RealtimeGraphBuilder
                samples={telemetry.sampleHistory}
                units={units}
                isStreamConnected={isStreamConnected}
              />
            </div>
          ) : (
            <div className="max-w-[1800px] mx-auto">
              <div className="border border-orange-500/40 rounded-lg p-6 bg-black/40 backdrop-blur-sm">
                <div className="text-gray-400 text-xs tracking-widest mb-2">DATA LAB</div>
                <div className="text-xl font-bold tracking-wide mb-2">CHART RENDERING DISABLED</div>
                <div className="text-sm text-gray-400">
                  Data ingestion remains active; only graph rendering is disabled for diagnostics.
                </div>
              </div>
            </div>
          ))}

        {activeTab === 'parameters' &&
          (deviceType === 'fc' ? (
            <ParametersPanel
              parameters={parameters}
              isLoading={parametersLoading}
              error={parametersError}
              expectedCount={parametersExpected}
              receivedCount={parameters.length}
              elapsedMs={parametersElapsedMs}
              onRefresh={() => {
                void loadParameters();
              }}
            />
          ) : (
            <div className="max-w-[1800px] mx-auto">
              <div className="border border-orange-500/40 rounded-lg p-6 bg-black/40 backdrop-blur-sm">
                <div className="text-gray-400 text-xs tracking-widest mb-2">PARAMETERS</div>
                <div className="text-xl font-bold tracking-wide mb-2">FC DEVICE REQUIRED</div>
                <div className="text-sm text-gray-400">
                  Set device to FC in Settings to access MAVLink parameters.
                </div>
              </div>
            </div>
          ))}

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
                  placeholder="Enter command (ARM, DISARM, RTL, HOLD)"
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
              <div className="text-xs text-gray-500 mt-3">
                Commands are case-insensitive: ARM, DISARM, RTL, HOLD.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-[1800px] mx-auto">
            <SettingsPanel
              deviceType={deviceType}
              vehicleType={vehicleType}
              theme={theme}
              units={units}
              ports={ports}
              selectedPort={selectedPort}
              selectedBaudrate={selectedBaudrate}
              selectedSerialTimeoutMs={selectedSerialTimeoutMs}
              historyPointLimit={historyPointLimit}
              processTelemetryUi={processTelemetryUi}
              renderDataLabCharts={renderDataLabCharts}
              terminalPacketLoggingEnabled={terminalPacketLoggingEnabled}
              diagnostics={diagnostics}
              isOpen={serialStatus.is_open}
              isBusy={connectionBusy}
              onDeviceTypeChange={setDeviceType}
              onVehicleTypeChange={setVehicleType}
              onThemeChange={setTheme}
              onUnitsChange={setUnits}
              onPortChange={setSelectedPort}
              onBaudrateChange={setSelectedBaudrate}
              onSerialTimeoutChange={setSelectedSerialTimeoutMs}
              onHistoryPointLimitChange={handleHistoryPointLimitChange}
              onProcessTelemetryUiChange={setProcessTelemetryUi}
              onRenderDataLabChartsChange={setRenderDataLabCharts}
              onTerminalPacketLoggingEnabledChange={setTerminalPacketLoggingEnabled}
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
