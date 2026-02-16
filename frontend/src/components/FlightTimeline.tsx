interface Stage {
  id: string;
  label: string;
}

interface FlightTimelineProps {
  currentTime: number;
  currentStageIndex?: number;
  stages?: Stage[];
}

const defaultStages: Stage[] = [
  { id: 'launch', label: 'LAUNCH' },
  { id: 'powered', label: 'POWERED FLIGHT' },
  { id: 'burnout', label: 'BURNOUT' },
  { id: 'apogee', label: 'APOGEE' },
  { id: 'freefall', label: 'FREE FALL' },
  { id: 'drogue', label: 'DROGUE DEPLOY' },
  { id: 'main', label: 'MAIN DEPLOY' },
];

export default function FlightTimeline({
  currentTime,
  currentStageIndex = 0,
  stages = defaultStages
}: FlightTimelineProps) {
  const formatTime = (seconds: number) => {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(wholeSeconds / 60);
    const secs = wholeSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const maxStageIndex = Math.max(stages.length - 1, 1);
  const boundedStageIndex = Math.min(Math.max(currentStageIndex, 0), stages.length - 1);
  const progressPercent = (boundedStageIndex / maxStageIndex) * 100;

  return (
    <div className="border border-orange-500/40 rounded-lg p-6 bg-black/40 backdrop-blur-sm">
      <div className="relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gray-700 rounded-full">
          <div
            className="h-full bg-orange-500 rounded-full transition-all duration-1000"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex justify-between items-start pt-6 relative">
          {stages.map((stage, index) => {
            const isActive = index === boundedStageIndex;
            const isCompleted = index < boundedStageIndex;

            return (
              <div
                key={stage.id}
                className="flex flex-col items-center"
              >
                <div
                  className={`w-4 h-4 rounded-full border-2 -mt-8 mb-2 transition-colors ${
                    isActive
                      ? 'bg-orange-500 border-orange-500 scale-125'
                      : isCompleted
                      ? 'bg-orange-500 border-orange-500'
                      : 'bg-gray-700 border-gray-600'
                  }`}
                />
                <div
                  className={`text-xs font-semibold tracking-wider whitespace-nowrap px-2 py-1 rounded ${
                    isActive
                      ? 'text-orange-500 bg-orange-500/20'
                      : isCompleted
                      ? 'text-orange-400'
                      : 'text-gray-500'
                  }`}
                >
                  {stage.label}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center mt-16 text-3xl font-bold text-white tracking-wider">
          T+ {formatTime(currentTime)}
        </div>
      </div>
    </div>
  );
}
