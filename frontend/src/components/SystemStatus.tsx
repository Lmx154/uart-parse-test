interface SystemStatusProps {
  primaryStatus: string;
  secondaryStatus: string;
}

export default function SystemStatus({
  primaryStatus = 'NOMINAL',
  secondaryStatus = 'ARMED'
}: SystemStatusProps) {
  return (
    <div className="border border-orange-500/40 rounded-lg p-4 bg-black/40 backdrop-blur-sm">
      <div className="text-gray-400 text-xs tracking-widest mb-3">SYSTEM STATUS</div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-xl font-bold text-green-500 tracking-wider">
            {primaryStatus}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
          <span className="text-xl font-bold text-red-500 tracking-wider">
            {secondaryStatus}
          </span>
        </div>
      </div>
    </div>
  );
}
