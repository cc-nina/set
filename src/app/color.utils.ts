/** Converts HSV (h: 0–360, s: 0–1, v: 0–1) to a lowercase hex string like `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(val * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

/** Converts a `#rrggbb` hex string to HSV (h: 0–360, s: 0–1, v: 0–1). */
export function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r)      h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r)  / d + 2;
    else                h = (r - g)  / d + 4;
    h *= 60;
  }
  return [h, max ? d / max : 0, max];
}

/** Euclidean RGB distance between two `#rrggbb` hex colours. */
export function colorDistance(h1: string, h2: string): number {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(h1);
  const [r2, g2, b2] = parse(h2);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}
