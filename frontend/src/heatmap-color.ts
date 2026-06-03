// Map a % change to a heatmap cell background. Linear ramp clamped at ±10%
// (anything beyond gets max saturation). Symmetric around zero.

const POS = [38, 208, 124];   // #26d07c
const NEG = [255, 92, 92];    // #ff5c5c

export function heatmapColor(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "rgba(31, 39, 51, 0.35)";
  const clamped = Math.max(-10, Math.min(10, pct));
  const intensity = Math.abs(clamped) / 10; // 0..1
  const [r, g, b] = clamped >= 0 ? POS : NEG;
  const alpha = 0.08 + intensity * 0.45;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}
