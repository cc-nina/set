import { Card, GameState } from './game.types';

const STORAGE_KEY = 'set-game-state';
const MP_STORAGE_KEY = 'set-game-state-mp';

export interface PersistedGameState {
  deck: Card[];
  board: Card[];
  selected: Card[];
  correctSets: number;
  incorrectSelections: number;
  status: 'active' | 'finished' | 'waiting';
}

function isAttr(v: unknown): boolean {
  return v === 1 || v === 2 || v === 3;
}

function isCard(v: unknown): v is Card {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c['id'] === 'string' &&
    isAttr(c['number']) && isAttr(c['color']) && isAttr(c['shape']) && isAttr(c['shading']);
}

function isCardArray(v: unknown): v is Card[] {
  return Array.isArray(v) && v.every(isCard);
}

function validate(raw: unknown): raw is PersistedGameState {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (!isCardArray(r['deck'])) return false;
  if (!isCardArray(r['board'])) return false;
  const boardLen = (r['board'] as Card[]).length;
  if (boardLen % 3 !== 0 || boardLen < 3) return false;
  if (!isCardArray(r['selected'])) return false;
  if (typeof r['correctSets'] !== 'number') return false;
  if (typeof r['incorrectSelections'] !== 'number') return false;
  if (r['status'] !== 'active' && r['status'] !== 'finished') return false;
  return true;
}

export function loadGameState(): PersistedGameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toPersistedFields(state: GameState): PersistedGameState {
  return {
    deck: state.deck,
    board: state.board,
    selected: state.selected,
    correctSets: state.correctSets,
    incorrectSelections: state.incorrectSelections,
    status: state.status,
  };
}

export function saveGameState(state: GameState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedFields(state)));
  } catch {
    // Private-browsing / storage quota — not fatal.
  }
}

export function saveMultiplayerState(roomId: string, state: GameState): void {
  try {
    localStorage.setItem(MP_STORAGE_KEY, JSON.stringify({ roomId, ...toPersistedFields(state) }));
  } catch {
    // Private-browsing / storage quota — not fatal.
  }
}

export function loadMultiplayerState(roomId: string): PersistedGameState | null {
  try {
    const raw = localStorage.getItem(MP_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;
    if (r['roomId'] !== roomId) return null;
    return validate(parsed) ? parsed as PersistedGameState : null;
  } catch {
    return null;
  }
}

export function clearMultiplayerState(): void {
  try {
    localStorage.removeItem(MP_STORAGE_KEY);
  } catch {
    // not fatal.
  }
}
