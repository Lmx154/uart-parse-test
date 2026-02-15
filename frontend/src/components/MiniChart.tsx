interface MiniChartProps {
  data: number[];
  color?: string;
}

export default function MiniChart({ data, color = '#f97316' }: MiniChartProps) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={`${points} 100,100 0,100`}
        fill={color}
        fillOpacity="0.2"
        stroke="none"
      />
    </svg>
  );
}
