import { useMemo, useState } from 'react';

export interface MavlinkParameter {
  name: string;
  value: number;
  type: number;
  index: number;
  count: number;
}

interface ParametersPanelProps {
  parameters: MavlinkParameter[];
  isLoading: boolean;
  error: string | null;
  expectedCount: number | null;
  receivedCount: number;
  elapsedMs: number | null;
  onRefresh: () => void;
}

const formatValue = (value: number) => {
  if (!Number.isFinite(value)) {
    return '--';
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(4);
};

export default function ParametersPanel({
  parameters,
  isLoading,
  error,
  expectedCount,
  receivedCount,
  elapsedMs,
  onRefresh,
}: ParametersPanelProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase();
    if (!needle) {
      return parameters;
    }
    return parameters.filter((parameter) => parameter.name.toUpperCase().includes(needle));
  }, [parameters, search]);

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      <div className="border border-orange-500/40 rounded-lg p-6 bg-black/40 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-gray-400 text-xs tracking-widest mb-1">FC PARAMETERS</div>
            <div className="text-2xl font-bold tracking-wide">MAVLINK PARAMETER LIST</div>
            <div className="text-sm text-gray-400 mt-1">
              Received: {receivedCount}
              {expectedCount === null ? '' : ` / ${expectedCount}`} parameters
              {elapsedMs === null ? '' : ` in ${elapsedMs} ms`}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search parameter"
              className="w-64 bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-semibold tracking-wider rounded border border-orange-500 text-orange-500 hover:bg-orange-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'LOADING...' : 'REFRESH'}
            </button>
          </div>
        </div>
        {error ? <div className="text-sm text-red-400 mt-3">{error}</div> : null}
      </div>

      <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700/60">
                <th className="text-left font-medium py-2 pr-3">Name</th>
                <th className="text-left font-medium py-2 pr-3">Value</th>
                <th className="text-left font-medium py-2 pr-3">Type</th>
                <th className="text-left font-medium py-2 pr-3">Index</th>
                <th className="text-left font-medium py-2">Count</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-gray-500">
                    {parameters.length === 0 ? 'No parameters loaded.' : 'No parameters match your search.'}
                  </td>
                </tr>
              ) : (
                filtered.map((parameter) => (
                  <tr key={parameter.name} className="border-b border-gray-800/60 last:border-b-0">
                    <td className="py-2 pr-3 font-mono">{parameter.name}</td>
                    <td className="py-2 pr-3">{formatValue(parameter.value)}</td>
                    <td className="py-2 pr-3">{parameter.type}</td>
                    <td className="py-2 pr-3">{parameter.index}</td>
                    <td className="py-2">{parameter.count}</td>
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
