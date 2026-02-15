interface BatteryDisplayProps {
  level: number;
}

export default function BatteryDisplay({ level }: BatteryDisplayProps) {
  return (
    <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
      <div className="text-gray-400 text-xs tracking-widest mb-3">BATTERY</div>
      <div className="flex items-center gap-3">
        <div className="relative w-16 h-8 border-2 border-orange-500 rounded">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-orange-500 translate-x-full rounded-r"></div>
          <div
            className="h-full bg-orange-500 transition-all rounded-sm"
            style={{ width: `${level}%` }}
          />
        </div>
        <span className="text-2xl font-bold text-white">{level}%</span>
      </div>
    </div>
  );
}
