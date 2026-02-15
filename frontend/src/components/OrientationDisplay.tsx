export default function OrientationDisplay() {
  return (
    <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
      <div className="text-gray-400 text-xs tracking-widest mb-3">3D ORIENTATION</div>
      <div className="relative w-full aspect-square flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-orange-500/30"></div>
        <div className="absolute inset-4 rounded-full border border-orange-500/20"></div>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-gray-400">N</div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-gray-400">S</div>
        <div className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">W</div>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">E</div>

        <div className="relative w-12 h-16 bg-gradient-to-b from-gray-400 to-gray-600 rounded-full flex items-center justify-center">
          <div className="w-8 h-8 bg-orange-500/20 rounded-full border border-orange-500"></div>
        </div>

        <div className="absolute left-1 top-8 text-[10px] text-gray-500">300</div>
        <div className="absolute right-1 top-8 text-[10px] text-gray-500">60</div>
        <div className="absolute left-1 bottom-8 text-[10px] text-gray-500">240</div>
        <div className="absolute right-1 bottom-8 text-[10px] text-gray-500">120</div>
      </div>
      <div className="text-center text-xs text-gray-500 mt-2 italic">
        [3D Visualization Placeholder]
      </div>
    </div>
  );
}
