export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Compact number for HP, damage and currency: 950, 1.2K, 34K, 5.6M. */
export function fmt(n: number): string {
  const v = Math.max(0, n);
  if (v < 1000) return String(v > 0 ? Math.max(1, Math.round(v)) : 0);
  const units = ['K', 'M', 'B', 'T'];
  let x = v;
  let u = -1;
  while (x >= 1000 && u < units.length - 1) {
    x /= 1000;
    u++;
  }
  return (x < 100 ? x.toFixed(1) : String(Math.round(x))) + units[u];
}
