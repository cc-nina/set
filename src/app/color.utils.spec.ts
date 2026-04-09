import { hsvToHex, hexToHsv, colorDistance } from './color.utils';

describe('color.utils', () => {

  // ── hsvToHex ──────────────────────────────────────────────────────────────

  describe('hsvToHex', () => {
    it('converts pure red (h=0, s=1, v=1) to #ff0000', () => {
      expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    });

    it('converts pure green (h=120, s=1, v=1) to #00ff00', () => {
      expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    });

    it('converts pure blue (h=240, s=1, v=1) to #0000ff', () => {
      expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
    });

    it('converts black (v=0) to #000000 regardless of hue/saturation', () => {
      expect(hsvToHex(0,   0, 0)).toBe('#000000');
      expect(hsvToHex(180, 1, 0)).toBe('#000000');
    });

    it('converts white (s=0, v=1) to #ffffff', () => {
      expect(hsvToHex(0, 0, 1)).toBe('#ffffff');
    });

    it('returns a lowercase 7-char hex string', () => {
      const result = hsvToHex(30, 0.5, 0.8);
      expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  // ── hexToHsv ──────────────────────────────────────────────────────────────

  describe('hexToHsv', () => {
    it('converts #ff0000 to h≈0, s=1, v=1', () => {
      const [h, s, v] = hexToHsv('#ff0000');
      expect(h).toBeCloseTo(0, 0);
      expect(s).toBeCloseTo(1, 5);
      expect(v).toBeCloseTo(1, 5);
    });

    it('converts #00ff00 to h≈120, s=1, v=1', () => {
      const [h, s, v] = hexToHsv('#00ff00');
      expect(h).toBeCloseTo(120, 0);
      expect(s).toBeCloseTo(1, 5);
      expect(v).toBeCloseTo(1, 5);
    });

    it('converts #000000 to v=0', () => {
      const [, , v] = hexToHsv('#000000');
      expect(v).toBe(0);
    });

    it('converts #ffffff to s=0, v=1', () => {
      const [, s, v] = hexToHsv('#ffffff');
      expect(s).toBe(0);
      expect(v).toBe(1);
    });

    it('returns a 3-tuple [h, s, v]', () => {
      const result = hexToHsv('#1a2b3c');
      expect(result).toHaveLength(3);
      result.forEach((n) => expect(typeof n).toBe('number'));
    });
  });

  // ── round-trip ────────────────────────────────────────────────────────────

  describe('hexToHsv → hsvToHex round-trip', () => {
    const samples = ['#cc0000', '#0aa64a', '#5a2ea6', '#000000', '#ffffff', '#808080', '#1a7fc4'];

    it.each(samples)('round-trips %s without loss', (hex) => {
      const [h, s, v] = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    });
  });

  // ── colorDistance ─────────────────────────────────────────────────────────

  describe('colorDistance', () => {
    it('returns 0 for identical colours', () => {
      expect(colorDistance('#ff0000', '#ff0000')).toBe(0);
      expect(colorDistance('#000000', '#000000')).toBe(0);
    });

    it('returns maximum distance between black and white', () => {
      // sqrt(255² + 255² + 255²) ≈ 441.67
      expect(colorDistance('#000000', '#ffffff')).toBeCloseTo(441.67, 1);
    });

    it('is symmetric', () => {
      const a = '#cc0000', b = '#0aa64a';
      expect(colorDistance(a, b)).toBe(colorDistance(b, a));
    });

    it('returns a positive value for different colours', () => {
      expect(colorDistance('#cc0000', '#0aa64a')).toBeGreaterThan(0);
    });

    it('similar colours have small distance', () => {
      // #cc0000 vs #cd0000 differ only by 1 in R
      expect(colorDistance('#cc0000', '#cd0000')).toBeCloseTo(1, 5);
    });
  });

});
