import MiniChart from './MiniChart';

interface ApogeeDisplayProps {
  apogee: number;
  unit?: string;
  data?: number[];
}

export default function ApogeeDisplay({
  apogee,
  unit = 'km',
  data = [120, 130, 140, 145, 150, 155, 158.4]
}: ApogeeDisplayProps) {
  return (
    <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
      <div className="text-gray-400 text-xs tracking-widest mb-2">APOGEE</div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-5xl font-bold text-white tracking-tight">
          {apogee.toFixed(1)}
        </span>
        <span className="text-xl text-gray-400">{unit}</span>
      </div>
      <div className="h-16 w-full">
        <MiniChart data={data} color="#f97316" />
      </div>
      <div className="text-gray-500 text-xs tracking-wider mt-2">PEAK ALTITUDE</div>
    </div>
  );
}
