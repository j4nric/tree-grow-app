const small = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 2 });

/** Zahlen deutsch formatiert: 12,5 · 1.234 · 3,45 Mio. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  return Math.abs(value) < 10_000 ? small.format(value) : compact.format(value);
}

export function formatRate(value: number): string {
  return `${formatNumber(value)}/s`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} Std. ${m} Min.`;
  if (m > 0) return `${m} Min.`;
  return `${Math.floor(seconds)} Sek.`;
}
