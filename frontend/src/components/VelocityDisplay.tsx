import MiniChart from './MiniChart';

interface VelocityDisplayProps {
  velocity: number;
  unit?: string;
  data?: number[];
}

export default function VelocityDisplay({
  velocity,
  unit = 'm/s',
  data = [2100, 2300, 2500, 2800, 2900, 3100, 3245]
}: VelocityDisplayProps) {
  return (
    <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
      <div className="text-gray-400 text-xs tracking-widest mb-2">VELOCITY</div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-5xl font-bold text-white tracking-tight">
          {velocity.toLocaleString()}
        </span>
        <span className="text-xl text-gray-400">{unit}</span>
      </div>
      <div className="h-16 w-full">
        <MiniChart data={data} color="#f97316" />
      </div>
    </div>
  );
}
