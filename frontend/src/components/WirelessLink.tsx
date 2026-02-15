interface WirelessLinkProps {
  strength: number;
}

export default function WirelessLink({ strength }: WirelessLinkProps) {
  const bars = [20, 40, 60, 80, 100];

  return (
    <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
      <div className="text-gray-400 text-xs tracking-widest mb-3">WIRELESS LINK</div>
      <div className="flex items-center gap-3">
        <div className="flex items-end gap-1 h-8">
          {bars.map((threshold, i) => (
            <div
              key={i}
              className={`w-2 transition-colors ${
                strength >= threshold ? 'bg-orange-500' : 'bg-gray-700'
              }`}
              style={{ height: `${(i + 1) * 20}%` }}
            />
          ))}
        </div>
        <span className="text-2xl font-bold text-white">{strength}%</span>
      </div>
    </div>
  );
}
