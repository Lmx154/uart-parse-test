import { useMemo, useState } from 'react';
import { LineChart, Plus, Trash2 } from 'lucide-react';

export type DataUnits = 'metric' | 'imperial';

export interface TelemetrySample {
  missionTime: number;
  frame: number;
  velocity: number;
  altitude: number;
  apogee: number;
  acceleration: number;
  battery: number;
  wireless: number;
  accelX: number | null;
  accelY: number | null;
  accelZ: number | null;
  gyroX: number | null;
  gyroY: number | null;
  gyroZ: number | null;
  magX: number | null;
  magY: number | null;
  magZ: number | null;
  pressurePa: number | null;
  tempC: number | null;
  latDeg: number | null;
  lonDeg: number | null;
}

type AxisKey =
  | 'missionTime'
  | 'frame'
  | 'velocity'
  | 'altitude'
  | 'apogee'
  | 'acceleration'
  | 'battery'
  | 'wireless'
  | 'accelX'
  | 'accelY'
  | 'accelZ'
  | 'gyroX'
  | 'gyroY'
  | 'gyroZ'
  | 'magX'
  | 'magY'
  | 'magZ'
  | 'pressurePa'
  | 'tempC'
  | 'latDeg'
  | 'lonDeg';

interface AxisOption {
  key: AxisKey;
  label: string;
  unitMetric?: string;
  unitImperial?: string;
}

interface GraphConfig {
  id: number;
  xKey: AxisKey;
  yKeys: AxisKey[];
}

interface RealtimeGraphBuilderProps {
  samples: TelemetrySample[];
  units: DataUnits;
  isStreamConnected: boolean;
}

interface MultiSeriesConfig {
  key: AxisKey;
  label: string;
  color: string;
}

const AXIS_OPTIONS: AxisOption[] = [
  { key: 'missionTime', label: 'Mission Time', unitMetric: 's', unitImperial: 's' },
  { key: 'frame', label: 'Frame', unitMetric: 'count', unitImperial: 'count' },
  { key: 'velocity', label: 'Velocity', unitMetric: 'm/s', unitImperial: 'ft/s' },
  { key: 'altitude', label: 'Altitude', unitMetric: 'm', unitImperial: 'ft' },
  { key: 'apogee', label: 'Apogee', unitMetric: 'm', unitImperial: 'ft' },
  { key: 'acceleration', label: 'Acceleration', unitMetric: 'm/s²', unitImperial: 'ft/s²' },
  { key: 'battery', label: 'Battery', unitMetric: '%', unitImperial: '%' },
  { key: 'wireless', label: 'Wireless Link', unitMetric: '%', unitImperial: '%' },
  { key: 'accelX', label: 'Accel X' },
  { key: 'accelY', label: 'Accel Y' },
  { key: 'accelZ', label: 'Accel Z' },
  { key: 'gyroX', label: 'Gyro X' },
  { key: 'gyroY', label: 'Gyro Y' },
  { key: 'gyroZ', label: 'Gyro Z' },
  { key: 'magX', label: 'Mag X' },
  { key: 'magY', label: 'Mag Y' },
  { key: 'magZ', label: 'Mag Z' },
  { key: 'pressurePa', label: 'Baro Pressure', unitMetric: 'Pa', unitImperial: 'Pa' },
  { key: 'tempC', label: 'Temperature', unitMetric: '°C', unitImperial: '°C' },
  { key: 'latDeg', label: 'Latitude', unitMetric: 'deg', unitImperial: 'deg' },
  { key: 'lonDeg', label: 'Longitude', unitMetric: 'deg', unitImperial: 'deg' },
];

const ALL_SIGNAL_SERIES: MultiSeriesConfig[] = [
  { key: 'accelX', label: 'Accel X', color: '#f97316' },
  { key: 'accelY', label: 'Accel Y', color: '#fb7185' },
  { key: 'accelZ', label: 'Accel Z', color: '#f59e0b' },
  { key: 'gyroX', label: 'Gyro X', color: '#22c55e' },
  { key: 'gyroY', label: 'Gyro Y', color: '#14b8a6' },
  { key: 'gyroZ', label: 'Gyro Z', color: '#0ea5e9' },
  { key: 'magX', label: 'Mag X', color: '#3b82f6' },
  { key: 'magY', label: 'Mag Y', color: '#6366f1' },
  { key: 'magZ', label: 'Mag Z', color: '#a855f7' },
  { key: 'pressurePa', label: 'Baro', color: '#84cc16' },
  { key: 'tempC', label: 'Temp', color: '#eab308' },
  { key: 'latDeg', label: 'Latitude', color: '#10b981' },
  { key: 'lonDeg', label: 'Longitude', color: '#38bdf8' },
];

const GRAPH_COLORS = ['#f97316', '#14b8a6', '#38bdf8', '#f43f5e', '#22c55e', '#eab308'];
const FEET_PER_METER = 3.28084;
const MAX_GRAPH_POINTS = 320;
const MAX_Y_AXES_PER_GRAPH = 10;

const SERIES_COLOR_BY_KEY: Partial<Record<AxisKey, string>> = {
  velocity: '#14b8a6',
  altitude: '#38bdf8',
  apogee: '#22c55e',
  acceleration: '#f43f5e',
  battery: '#eab308',
  wireless: '#84cc16',
  accelX: '#f97316',
  accelY: '#fb7185',
  accelZ: '#f59e0b',
  gyroX: '#22c55e',
  gyroY: '#14b8a6',
  gyroZ: '#0ea5e9',
  magX: '#3b82f6',
  magY: '#6366f1',
  magZ: '#a855f7',
  pressurePa: '#84cc16',
  tempC: '#eab308',
  latDeg: '#10b981',
  lonDeg: '#38bdf8',
};

const getAxisOption = (key: AxisKey) => AXIS_OPTIONS.find((option) => option.key === key) ?? AXIS_OPTIONS[0];

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return '--';
  }
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toFixed(0);
  }
  if (abs >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
};

const formatSeriesNumber = (key: AxisKey, value: number | null) => {
  if (value === null || !Number.isFinite(value)) {
    return '--';
  }
  if (key === 'latDeg' || key === 'lonDeg') {
    return value.toFixed(6);
  }
  if (key === 'pressurePa') {
    return value.toFixed(0);
  }
  if (key === 'tempC') {
    return value.toFixed(1);
  }
  return formatNumber(value);
};

const convertValue = (rawValue: number, axisKey: AxisKey, units: DataUnits) => {
  if (units === 'imperial') {
    if (axisKey === 'velocity' || axisKey === 'altitude' || axisKey === 'apogee' || axisKey === 'acceleration') {
      return rawValue * FEET_PER_METER;
    }
  }
  return rawValue;
};

const getAxisLabel = (axisKey: AxisKey, units: DataUnits) => {
  const axis = getAxisOption(axisKey);
  const unit = units === 'metric' ? axis.unitMetric : axis.unitImperial;
  return unit ? `${axis.label} (${unit})` : axis.label;
};

const getAxisValue = (sample: TelemetrySample, axisKey: AxisKey, units: DataUnits) => {
  const rawValue = sample[axisKey];
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return null;
  }
  return convertValue(rawValue, axisKey, units);
};

const getSeriesColor = (axisKey: AxisKey, fallbackIndex: number) =>
  SERIES_COLOR_BY_KEY[axisKey] ?? GRAPH_COLORS[fallbackIndex % GRAPH_COLORS.length];

export default function RealtimeGraphBuilder({
  samples,
  units,
  isStreamConnected,
}: RealtimeGraphBuilderProps) {
  const [graphs, setGraphs] = useState<GraphConfig[]>([
    { id: 1, xKey: 'missionTime', yKeys: ['altitude'] },
  ]);
  const [nextGraphId, setNextGraphId] = useState(2);

  const latest = samples[samples.length - 1];
  const recentRows = useMemo(() => samples.slice(-10).reverse(), [samples]);
  const allSignalWindow = useMemo(() => samples.slice(-320), [samples]);

  const allSignalLines = useMemo(() => {
    const minX = 5;
    const maxX = 95;
    const minY = 8;
    const maxY = 56;
    const maxIndex = Math.max(allSignalWindow.length - 1, 1);

    return ALL_SIGNAL_SERIES.map((series) => {
      const rawPoints = allSignalWindow
        .map((sample, index) => ({
          index,
          value: getAxisValue(sample, series.key, units),
        }))
        .filter((point): point is { index: number; value: number } => point.value !== null);

      const values = rawPoints.map((point) => point.value);
      const minValue = values.length ? Math.min(...values) : 0;
      const maxValue = values.length ? Math.max(...values) : 1;
      const range = maxValue - minValue || 1;

      const polyline = rawPoints
        .map((point) => {
          const x = minX + (point.index / maxIndex) * (maxX - minX);
          const y = maxY - ((point.value - minValue) / range) * (maxY - minY);
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');

      return {
        ...series,
        hasData: rawPoints.length >= 2,
        polyline,
        latestValue: rawPoints.length ? rawPoints[rawPoints.length - 1].value : null,
      };
    });
  }, [allSignalWindow, units]);

  const addGraph = () => {
    setGraphs((previous) => [
      ...previous,
      {
        id: nextGraphId,
        xKey: 'missionTime',
        yKeys: ['velocity'],
      },
    ]);
    setNextGraphId((previous) => previous + 1);
  };

  const updateGraphXAxis = (graphId: number, nextAxis: AxisKey) => {
    setGraphs((previous) =>
      previous.map((graph) => (graph.id === graphId ? { ...graph, xKey: nextAxis } : graph))
    );
  };

  const updateGraphYAxis = (graphId: number, axisIndex: number, nextAxis: AxisKey) => {
    setGraphs((previous) =>
      previous.map((graph) => {
        if (graph.id !== graphId) {
          return graph;
        }
        const nextYKeys = [...graph.yKeys];
        nextYKeys[axisIndex] = nextAxis;
        return { ...graph, yKeys: nextYKeys };
      })
    );
  };

  const addGraphYAxis = (graphId: number) => {
    setGraphs((previous) =>
      previous.map((graph) => {
        if (graph.id !== graphId || graph.yKeys.length >= MAX_Y_AXES_PER_GRAPH) {
          return graph;
        }
        const nextOption = AXIS_OPTIONS.find((option) => !graph.yKeys.includes(option.key));
        if (!nextOption) {
          return graph;
        }
        return { ...graph, yKeys: [...graph.yKeys, nextOption.key] };
      })
    );
  };

  const removeGraphYAxis = (graphId: number, axisIndex: number) => {
    setGraphs((previous) =>
      previous.map((graph) => {
        if (graph.id !== graphId || graph.yKeys.length <= 1) {
          return graph;
        }
        return {
          ...graph,
          yKeys: graph.yKeys.filter((_, index) => index !== axisIndex),
        };
      })
    );
  };

  const removeGraph = (graphId: number) => {
    setGraphs((previous) => {
      if (previous.length === 1) {
        return previous;
      }
      return previous.filter((graph) => graph.id !== graphId);
    });
  };

  return (
    <div className="max-w-[1800px] mx-auto space-y-6">
      <div className="border border-orange-500/40 rounded-lg p-6 bg-black/40 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-gray-400 text-xs tracking-widest mb-2">DATA LAB</div>
            <h2 className="text-2xl font-bold tracking-wide">REAL-TIME GRAPH BUILDER</h2>
            <p className="text-sm text-gray-400 mt-2">
              Build custom live plots by pairing any telemetry field on X with up to 10 Y series.
            </p>
          </div>
          <button
            type="button"
            onClick={addGraph}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold tracking-wider rounded border border-orange-500 text-orange-500 hover:bg-orange-500/20 transition-colors"
          >
            <Plus size={14} />
            ADD GRAPH
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6 text-sm">
          <div className="border border-orange-500/30 rounded p-3">
            <div className="text-xs text-gray-400 tracking-wider">STREAM</div>
            <div className="font-semibold mt-1">{isStreamConnected ? 'ONLINE' : 'OFFLINE'}</div>
          </div>
          <div className="border border-orange-500/30 rounded p-3">
            <div className="text-xs text-gray-400 tracking-wider">SAMPLES</div>
            <div className="font-semibold mt-1">{samples.length}</div>
          </div>
          <div className="border border-orange-500/30 rounded p-3">
            <div className="text-xs text-gray-400 tracking-wider">MISSION TIME</div>
            <div className="font-semibold mt-1">{latest ? `${latest.missionTime.toFixed(1)} s` : '--'}</div>
          </div>
          <div className="border border-orange-500/30 rounded p-3">
            <div className="text-xs text-gray-400 tracking-wider">VELOCITY</div>
            <div className="font-semibold mt-1">
              {latest
                ? `${formatNumber(getAxisValue(latest, 'velocity', units) ?? 0)} ${units === 'metric' ? 'm/s' : 'ft/s'}`
                : '--'}
            </div>
          </div>
          <div className="border border-orange-500/30 rounded p-3">
            <div className="text-xs text-gray-400 tracking-wider">ALTITUDE</div>
            <div className="font-semibold mt-1">
              {latest
                ? `${formatNumber(getAxisValue(latest, 'altitude', units) ?? 0)} ${units === 'metric' ? 'm' : 'ft'}`
                : '--'}
            </div>
          </div>
        </div>
      </div>

      <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
        <div className="text-gray-400 text-xs tracking-widest mb-2">ALL SIGNALS LIVE</div>
        <div className="text-sm text-gray-400 mb-4">
          Combined live chart for all parsed sensor variables. Each trace is normalized to its own range so all lines remain visible.
        </div>
        <div className="h-72 border border-orange-500/20 rounded bg-black/30">
          {allSignalLines.some((line) => line.hasData) ? (
            <svg viewBox="0 0 100 64" className="w-full h-full">
              <line x1="5" y1="8" x2="5" y2="56" stroke="rgba(148, 163, 184, 0.25)" strokeWidth="0.4" />
              <line x1="5" y1="56" x2="95" y2="56" stroke="rgba(148, 163, 184, 0.25)" strokeWidth="0.4" />
              <line x1="5" y1="32" x2="95" y2="32" stroke="rgba(148, 163, 184, 0.15)" strokeWidth="0.3" />
              {allSignalLines.map((line) =>
                line.hasData ? (
                  <polyline
                    key={line.key}
                    points={line.polyline}
                    fill="none"
                    stroke={line.color}
                    strokeWidth="0.55"
                    vectorEffect="non-scaling-stroke"
                    opacity="0.95"
                  />
                ) : null
              )}
            </svg>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              Waiting for parsed sensor telemetry (IMU, MAG, BARO, GPS) to populate the all-signals chart.
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 text-xs">
          {allSignalLines.map((line) => (
            <div key={line.key} className="border border-gray-700/70 rounded px-2 py-2 bg-black/30">
              <div className="flex items-center gap-2 text-gray-400">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: line.color }} />
                <span className="tracking-wider">{line.label}</span>
              </div>
              <div className="text-gray-200 mt-1">{formatSeriesNumber(line.key, line.latestValue)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {graphs.map((graph, index) => {
          const windowSamples = samples.slice(-MAX_GRAPH_POINTS);
          const series = graph.yKeys.map((yKey, seriesIndex) => {
            const points = windowSamples
              .map((sample, sampleIndex) => {
                const xValue = getAxisValue(sample, graph.xKey, units);
                const yValue = getAxisValue(sample, yKey, units);
                if (xValue === null || yValue === null) {
                  return null;
                }
                const adjustedX =
                  graph.xKey === 'missionTime' ? xValue + sampleIndex * 0.0001 : xValue;
                return { x: adjustedX, y: yValue };
              })
              .filter((point): point is { x: number; y: number } => point !== null);

            return {
              yKey,
              color: getSeriesColor(yKey, seriesIndex),
              points,
              latestPoint: points[points.length - 1] ?? null,
            };
          });

          const flattenedPoints = series.flatMap((line) => line.points);
          const hasGraphData = series.some((line) => line.points.length >= 2);

          const xValues = flattenedPoints.map((point) => point.x);
          const yValues = flattenedPoints.map((point) => point.y);
          const xMin = xValues.length ? Math.min(...xValues) : 0;
          const xMax = xValues.length ? Math.max(...xValues) : 1;
          const yMin = yValues.length ? Math.min(...yValues) : 0;
          const yMax = yValues.length ? Math.max(...yValues) : 1;

          const xRange = xMax - xMin || 1;
          const yRange = yMax - yMin || 1;

          const minX = 8;
          const maxX = 92;
          const minY = 8;
          const maxY = 52;

          const seriesWithPolylines = series.map((line) => {
            const polyline = line.points
              .map((point) => {
                const normalizedX = ((point.x - xMin) / xRange) * (maxX - minX) + minX;
                const normalizedY = maxY - ((point.y - yMin) / yRange) * (maxY - minY);
                return `${normalizedX.toFixed(2)},${normalizedY.toFixed(2)}`;
              })
              .join(' ');
            return {
              ...line,
              hasData: line.points.length >= 2,
              polyline,
            };
          });

          const graphAccentColor = seriesWithPolylines[0]?.color ?? GRAPH_COLORS[index % GRAPH_COLORS.length];

          return (
            <div key={graph.id} className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 text-sm font-semibold tracking-wider">
                  <LineChart size={16} style={{ color: graphAccentColor }} />
                  GRAPH {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() => removeGraph(graph.id)}
                  disabled={graphs.length === 1}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] tracking-wider rounded border border-gray-600 text-gray-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 size={12} />
                  REMOVE
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                <label className="space-y-1">
                  <span className="text-gray-400 tracking-wider">X AXIS</span>
                  <select
                    value={graph.xKey}
                    onChange={(event) => updateGraphXAxis(graph.id, event.target.value as AxisKey)}
                    className="w-full bg-black/40 border border-gray-700 rounded px-2 py-2 text-sm focus:outline-none focus:border-orange-500"
                  >
                    {AXIS_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {getAxisLabel(option.key, units)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 tracking-wider">Y AXES ({graph.yKeys.length}/{MAX_Y_AXES_PER_GRAPH})</span>
                    <button
                      type="button"
                      onClick={() => addGraphYAxis(graph.id)}
                      disabled={
                        graph.yKeys.length >= MAX_Y_AXES_PER_GRAPH || graph.yKeys.length >= AXIS_OPTIONS.length
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] tracking-wider rounded border border-orange-500/70 text-orange-300 hover:bg-orange-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus size={11} />
                      ADD Y
                    </button>
                  </div>
                  <div className="space-y-2">
                    {graph.yKeys.map((yKey, axisIndex) => (
                      <div key={`${graph.id}-${axisIndex}`} className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getSeriesColor(yKey, axisIndex) }}
                        />
                        <select
                          value={yKey}
                          onChange={(event) => updateGraphYAxis(graph.id, axisIndex, event.target.value as AxisKey)}
                          className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-2 text-sm focus:outline-none focus:border-orange-500"
                        >
                          {AXIS_OPTIONS.filter(
                            (option) => option.key === yKey || !graph.yKeys.includes(option.key)
                          ).map((option) => (
                            <option key={option.key} value={option.key}>
                              {getAxisLabel(option.key, units)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeGraphYAxis(graph.id, axisIndex)}
                          disabled={graph.yKeys.length <= 1}
                          className="px-2 py-1 text-[11px] tracking-wider rounded border border-gray-600 text-gray-300 hover:border-red-500 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          RM
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="h-64 border border-orange-500/20 rounded bg-black/30">
                {hasGraphData ? (
                  <svg viewBox="0 0 100 60" className="w-full h-full">
                    <line x1="8" y1="8" x2="8" y2="52" stroke="rgba(148, 163, 184, 0.25)" strokeWidth="0.4" />
                    <line x1="8" y1="52" x2="92" y2="52" stroke="rgba(148, 163, 184, 0.25)" strokeWidth="0.4" />
                    <line x1="8" y1="30" x2="92" y2="30" stroke="rgba(148, 163, 184, 0.15)" strokeWidth="0.3" />
                    {seriesWithPolylines.map((line) =>
                      line.hasData ? (
                        <polyline
                          key={`${graph.id}-${line.yKey}`}
                          points={line.polyline}
                          fill="none"
                          stroke={line.color}
                          strokeWidth="0.75"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null
                    )}
                  </svg>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-500">
                    Waiting for enough telemetry points to render this graph.
                  </div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-400">
                <div>
                  <div className="tracking-wider mb-1">X RANGE</div>
                  <div className="text-gray-300">
                    {getAxisLabel(graph.xKey, units)}: {formatNumber(xMin)} {'->'} {formatNumber(xMax)}
                  </div>
                </div>
                <div>
                  <div className="tracking-wider mb-1">Y RANGE</div>
                  <div className="text-gray-300">
                    Combined Y: {formatNumber(yMin)} {'->'} {formatNumber(yMax)}
                  </div>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500">
                {seriesWithPolylines.map((line) => (
                  <div key={`latest-${graph.id}-${line.yKey}`} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: line.color }} />
                    <span>
                      {getAxisOption(line.yKey).label}: {formatSeriesNumber(line.yKey, line.latestPoint?.y ?? null)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
        <div className="text-gray-400 text-xs tracking-widest mb-3">LATEST TELEMETRY ROWS</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700/60">
                <th className="text-left font-medium py-2 pr-3">t (s)</th>
                <th className="text-left font-medium py-2 pr-3">Frame</th>
                <th className="text-left font-medium py-2 pr-3">Velocity ({units === 'metric' ? 'm/s' : 'ft/s'})</th>
                <th className="text-left font-medium py-2 pr-3">Altitude ({units === 'metric' ? 'm' : 'ft'})</th>
                <th className="text-left font-medium py-2 pr-3">Battery (%)</th>
                <th className="text-left font-medium py-2">Wireless (%)</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-gray-500">
                    No telemetry samples yet.
                  </td>
                </tr>
              ) : (
                recentRows.map((row) => (
                  <tr key={`${row.frame}-${row.missionTime}`} className="border-b border-gray-800/60 last:border-b-0">
                    <td className="py-2 pr-3">{row.missionTime.toFixed(1)}</td>
                    <td className="py-2 pr-3">{row.frame}</td>
                    <td className="py-2 pr-3">{formatNumber(getAxisValue(row, 'velocity', units) ?? 0)}</td>
                    <td className="py-2 pr-3">{formatNumber(getAxisValue(row, 'altitude', units) ?? 0)}</td>
                    <td className="py-2 pr-3">{formatNumber(row.battery)}</td>
                    <td className="py-2">{formatNumber(row.wireless)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
