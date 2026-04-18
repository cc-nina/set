import { loadColorPrefs, saveColorPrefs, ColorPrefs } from './color-prefs.storage';

// ── localStorage mock ────────────────────────────────────────────────────────

function makeMockStorage() {
  const store: Record<string, string> = {};
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { Object.keys(store).forEach((k) => delete store[k]); },
    store,
  };
}

const STORAGE_KEY = 'set-game-color-prefs';

const VALID_PREFS: ColorPrefs = {
  palette: ['#db2c05', '#0c8d1b', '#4F158A'],
  highlightColor: '#000000',
};

describe('color-prefs.storage', () => {
  let originalStorage: Storage;
  let mock: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    mock = makeMockStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mock, configurable: true, writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalStorage, configurable: true, writable: true,
    });
  });

  // ── saveColorPrefs ────────────────────────────────────────────────────────

  describe('saveColorPrefs', () => {
    it('writes JSON to the correct key', () => {
      saveColorPrefs(VALID_PREFS);
      const raw = mock.store[STORAGE_KEY];
      expect(raw).toBeDefined();
      expect(JSON.parse(raw)).toEqual(VALID_PREFS);
    });

    it('overwrites previous value', () => {
      saveColorPrefs(VALID_PREFS);
      const updated: ColorPrefs = { palette: ['#111111', '#222222', '#333333'], highlightColor: '#ffffff' };
      saveColorPrefs(updated);
      expect(JSON.parse(mock.store[STORAGE_KEY])).toEqual(updated);
    });

    it('does not throw when localStorage.setItem throws (e.g. quota exceeded)', () => {
      mock.setItem = () => { throw new DOMException('QuotaExceededError'); };
      expect(() => saveColorPrefs(VALID_PREFS)).not.toThrow();
    });
  });

  // ── loadColorPrefs ────────────────────────────────────────────────────────

  describe('loadColorPrefs', () => {
    it('returns null when key does not exist', () => {
      expect(loadColorPrefs()).toBeNull();
    });

    it('returns the stored prefs when data is valid', () => {
      mock.store[STORAGE_KEY] = JSON.stringify(VALID_PREFS);
      expect(loadColorPrefs()).toEqual(VALID_PREFS);
    });

    it('returns null for invalid JSON', () => {
      mock.store[STORAGE_KEY] = 'not-json{{';
      expect(loadColorPrefs()).toBeNull();
    });

    it('returns null when palette has wrong length', () => {
      mock.store[STORAGE_KEY] = JSON.stringify({ palette: ['#DB2C05', '#0C8D1B'], highlightColor: '#000000' });
      expect(loadColorPrefs()).toBeNull();
    });

    it('returns null when a palette entry is not a valid hex', () => {
      mock.store[STORAGE_KEY] = JSON.stringify({ palette: ['red', '#0C8D1B', '#4F158A'], highlightColor: '#000000' });
      expect(loadColorPrefs()).toBeNull();
    });

    it('returns null when highlightColor is not a valid hex', () => {
      mock.store[STORAGE_KEY] = JSON.stringify({ ...VALID_PREFS, highlightColor: 'black' });
      expect(loadColorPrefs()).toBeNull();
    });

    it('returns null when palette entries contain uppercase hex (must be lowercase)', () => {
      // The validator uses /^#[0-9a-f]{6}$/ — uppercase is invalid
      mock.store[STORAGE_KEY] = JSON.stringify({ palette: ['#DB2C05', '#0C8D1B', '#4F158A'], highlightColor: '#000000' });
      expect(loadColorPrefs()).toBeNull();
    });

    it('returns null when the stored value is not an object', () => {
      mock.store[STORAGE_KEY] = JSON.stringify(42);
      expect(loadColorPrefs()).toBeNull();
    });

    it('returns null when palette key is missing entirely', () => {
      mock.store[STORAGE_KEY] = JSON.stringify({ highlightColor: '#000000' });
      expect(loadColorPrefs()).toBeNull();
    });

    it('does not throw when localStorage.getItem throws', () => {
      mock.getItem = () => { throw new Error('SecurityError'); };
      expect(() => loadColorPrefs()).not.toThrow();
      expect(loadColorPrefs()).toBeNull();
    });
  });

  // ── round-trip ────────────────────────────────────────────────────────────

  it('round-trips: save then load returns identical object', () => {
    saveColorPrefs(VALID_PREFS);
    expect(loadColorPrefs()).toEqual(VALID_PREFS);
  });

});
