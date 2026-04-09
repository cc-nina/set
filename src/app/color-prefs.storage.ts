/**
 * Typed, validated localStorage helpers for colour preferences.
 * All functions are pure (no Angular deps) and SSR-safe — callers must guard
 * against non-browser environments before calling.
 */

const STORAGE_KEY = 'set-game-color-prefs';

/** The shape persisted to localStorage. */
export interface ColorPrefs {
  /** Three card-colour hex strings (palette slots 1–3). */
  palette: [string, string, string];
  /** Selection highlight hex string. */
  highlightColor: string;
}

const HEX_RE = /^#[0-9a-f]{6}$/;

function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

/** Validate that a raw parsed value matches ColorPrefs exactly. */
function validate(raw: unknown): raw is ColorPrefs {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r['palette']) || r['palette'].length !== 3) return false;
  if (!r['palette'].every(isHex)) return false;
  if (!isHex(r['highlightColor'])) return false;
  return true;
}

/** Load preferences from localStorage. Returns `null` on any failure. */
export function loadColorPrefs(): ColorPrefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist preferences to localStorage. Silently swallows quota/security errors. */
export function saveColorPrefs(prefs: ColorPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private-browsing / storage quota — not fatal.
  }
}
