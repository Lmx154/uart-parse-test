interface SerialPortOption {
  value: string;
  label: string;
}

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

interface SettingsPanelProps {
  theme: 'dark' | 'light';
  units: 'metric' | 'imperial';
  ports: SerialPortOption[];
  selectedPort: string;
  selectedBaudrate: number;
  selectedSerialTimeoutMs: number | null;
  historyPointLimit: number;
  processTelemetryUi: boolean;
  renderDataLabCharts: boolean;
  terminalPacketLoggingEnabled: boolean;
  diagnostics: DiagnosticsSnapshot;
  isOpen: boolean;
  isBusy: boolean;
  onThemeChange: (theme: 'dark' | 'light') => void;
  onUnitsChange: (units: 'metric' | 'imperial') => void;
  onPortChange: (port: string) => void;
  onBaudrateChange: (baudrate: number) => void;
  onSerialTimeoutChange: (timeoutMs: number | null) => void;
  onHistoryPointLimitChange: (points: number) => void;
  onProcessTelemetryUiChange: (enabled: boolean) => void;
  onRenderDataLabChartsChange: (enabled: boolean) => void;
  onTerminalPacketLoggingEnabledChange: (enabled: boolean) => void;
  onRefreshPorts: () => void;
  onToggleConnection: () => void;
}

export default function SettingsPanel({
  theme,
  units,
  ports,
  selectedPort,
  selectedBaudrate,
  selectedSerialTimeoutMs,
  historyPointLimit,
  processTelemetryUi,
  renderDataLabCharts,
  terminalPacketLoggingEnabled,
  diagnostics,
  isOpen,
  isBusy,
  onThemeChange,
  onUnitsChange,
  onPortChange,
  onBaudrateChange,
  onSerialTimeoutChange,
  onHistoryPointLimitChange,
  onProcessTelemetryUiChange,
  onRenderDataLabChartsChange,
  onTerminalPacketLoggingEnabledChange,
  onRefreshPorts,
  onToggleConnection,
}: SettingsPanelProps) {
  return (
    <div className="border border-orange-500/40 rounded-lg bg-black/40 backdrop-blur-sm p-5 space-y-6">
      <div>
        <div className="text-gray-400 text-xs tracking-widest mb-3">CONNECTION</div>
        <div className="flex items-center gap-3">
          <select
            value={selectedPort}
            onChange={(event) => onPortChange(event.target.value)}
            className="flex-1 bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 min-w-0"
          >
            <option value="">Select serial port</option>
            {ports.map((port) => (
              <option key={port.value} value={port.value}>
                {port.label}
              </option>
            ))}
          </select>
          <select
            value={selectedBaudrate}
            onChange={(event) => onBaudrateChange(Number(event.target.value))}
            disabled={isOpen}
            className="w-32 bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map((baudrate) => (
              <option key={baudrate} value={baudrate}>
                {baudrate}
              </option>
            ))}
          </select>
          <select
            value={selectedSerialTimeoutMs === null ? 'none' : String(selectedSerialTimeoutMs)}
            onChange={(event) => {
              const value = event.target.value;
              onSerialTimeoutChange(value === 'none' ? null : Number(value));
            }}
            disabled={isOpen}
            className="w-40 bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="none">timeout: never</option>
            {[50, 100, 200, 500, 1000, 2000, 5000].map((timeoutMs) => (
              <option key={timeoutMs} value={timeoutMs}>
                timeout: {timeoutMs} ms
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRefreshPorts}
            className="px-3 py-2 text-xs font-semibold tracking-wider border border-gray-700 text-gray-300 rounded hover:border-orange-500 hover:text-orange-500 transition-colors"
          >
            REFRESH
          </button>
          <button
            type="button"
            onClick={onToggleConnection}
            disabled={isBusy || (!isOpen && !selectedPort)}
            className="px-3 py-2 text-xs font-semibold tracking-wider rounded border border-orange-500 text-orange-500 hover:bg-orange-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? 'WORKING...' : isOpen ? 'CLOSE' : 'OPEN'}
          </button>
        </div>
        <div className="text-[11px] text-gray-500 mt-2">
          Use `timeout: never` to keep read calls blocking with no serial read timeout.
        </div>
      </div>

      <div>
        <div className="text-gray-400 text-xs tracking-widest mb-3">DATA BUFFER</div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-400 tracking-wider">Telemetry points kept</label>
          <select
            value={historyPointLimit}
            onChange={(event) => onHistoryPointLimitChange(Number(event.target.value))}
            className="w-28 bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
          >
            {[10, 20, 50, 100, 200, 500].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="text-[11px] text-gray-500 mt-2">
          Lower values use less memory and keep the UI responsive.
        </div>
      </div>

      <div>
        <div className="text-gray-400 text-xs tracking-widest mb-3">DIAGNOSTICS</div>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-300">Process telemetry for UI</span>
            <input
              type="checkbox"
              checked={processTelemetryUi}
              onChange={(event) => onProcessTelemetryUiChange(event.target.checked)}
              className="h-4 w-4 accent-orange-500"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-300">Render Data Lab charts</span>
            <input
              type="checkbox"
              checked={renderDataLabCharts}
              onChange={(event) => onRenderDataLabChartsChange(event.target.checked)}
              className="h-4 w-4 accent-orange-500"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-300">Terminal packet logging</span>
            <input
              type="checkbox"
              checked={terminalPacketLoggingEnabled}
              onChange={(event) => onTerminalPacketLoggingEnabledChange(event.target.checked)}
              className="h-4 w-4 accent-orange-500"
            />
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              WS pkt/s: {diagnostics.wsPacketsPerSec}
            </div>
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              Telemetry pkt/s: {diagnostics.telemetryProcessedPerSec}
            </div>
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              Telemetry commits/s: {diagnostics.telemetryCommitsPerSec}
            </div>
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              Terminal commits/s: {diagnostics.terminalCommitsPerSec}
            </div>
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              Terminal lines: {diagnostics.terminalBufferedLines}
            </div>
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              Terminal drops/s: {diagnostics.terminalPacketLogsDroppedPerSec}
            </div>
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              Last packet: {diagnostics.msSinceLastPacket === null ? '--' : `${diagnostics.msSinceLastPacket} ms`}
            </div>
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              Queue depth: {diagnostics.backendQueueDepth}
            </div>
            <div className="border border-gray-700 rounded px-2 py-1 text-gray-300">
              Queue dropped: {diagnostics.backendQueueDropped}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-gray-400 text-xs tracking-widest mb-3">THEME</div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onThemeChange('dark')}
            className={`px-3 py-2 text-xs font-semibold tracking-wider rounded border transition-colors ${
              theme === 'dark'
                ? 'border-orange-500 text-orange-500 bg-orange-500/20'
                : 'border-gray-700 text-gray-300 hover:border-orange-500 hover:text-orange-500'
            }`}
          >
            DARK
          </button>
          <button
            type="button"
            onClick={() => onThemeChange('light')}
            className={`px-3 py-2 text-xs font-semibold tracking-wider rounded border transition-colors ${
              theme === 'light'
                ? 'border-orange-500 text-orange-500 bg-orange-500/20'
                : 'border-gray-700 text-gray-300 hover:border-orange-500 hover:text-orange-500'
            }`}
          >
            LIGHT
          </button>
        </div>
      </div>

      <div>
        <div className="text-gray-400 text-xs tracking-widest mb-3">UNITS</div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onUnitsChange('metric')}
            className={`px-3 py-2 text-xs font-semibold tracking-wider rounded border transition-colors ${
              units === 'metric'
                ? 'border-orange-500 text-orange-500 bg-orange-500/20'
                : 'border-gray-700 text-gray-300 hover:border-orange-500 hover:text-orange-500'
            }`}
          >
            METRIC
          </button>
          <button
            type="button"
            onClick={() => onUnitsChange('imperial')}
            className={`px-3 py-2 text-xs font-semibold tracking-wider rounded border transition-colors ${
              units === 'imperial'
                ? 'border-orange-500 text-orange-500 bg-orange-500/20'
                : 'border-gray-700 text-gray-300 hover:border-orange-500 hover:text-orange-500'
            }`}
          >
            IMPERIAL
          </button>
        </div>
      </div>
    </div>
  );
}
