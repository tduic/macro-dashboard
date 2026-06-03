// Minimal SVG sparkline — no axes, no labels, just the line shape.
// Direction-colored: green if last >= first, red otherwise. Neutral gray if flat.

type Props = {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
};

const PAD = 2; // px breathing room top/bottom so the line doesn't kiss the edge

export function Sparkline({ values, width = 92, height = 28, className }: Props) {
  if (!values || values.length < 2) return null;

  const first = values[0];
  const last = values[values.length - 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const innerH = height - PAD * 2;
  const stepX = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = PAD + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  // Direction color
  const stroke = last > first ? "#26d07c" : last < first ? "#ff5c5c" : "#5b6772";

  // End-dot for the latest value
  const [lx, ly] = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <path d={path} stroke={stroke} strokeWidth={1.25} fill="none" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={1.6} fill={stroke} />
    </svg>
  );
}
