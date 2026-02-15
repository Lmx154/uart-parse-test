import MiniChart from './MiniChart';

interface AltitudeDisplayProps {
  altitude: number;
  unit?: string;
  data?: number[];
}

export default function AltitudeDisplay({
  altitude,
  unit = 'km',
  data = [12, 18, 25, 32, 38, 42, 45.2]
}: AltitudeDisplayProps) {
  return (
    <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
      <div className="text-gray-400 text-xs tracking-widest mb-2">ALTITUDE</div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-5xl font-bold text-white tracking-tight">
          {altitude.toFixed(1)}
        </span>
        <span className="text-xl text-gray-400">{unit}</span>
      </div>
      <div className="h-16 w-full">
        <MiniChart data={data} color="#f97316" />
      </div>
    </div>
  );
}
