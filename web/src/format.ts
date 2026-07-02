/** Formatting helpers shared by the table and the detail panel. */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdPrecise = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 4,
});
const compact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});

/** Sub-dollar coins (DOGE etc.) need significant digits, not 2 decimals. */
export function formatPrice(value: number): string {
  return value >= 1 ? usd.format(value) : usdPrecise.format(value);
}

export function formatMarketCap(value: number | null): string {
  return value === null ? '—' : compact.format(value);
}

export function formatChange(value: number | null): string {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatAge(ageMs: number): string {
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
