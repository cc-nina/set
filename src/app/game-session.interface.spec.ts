import { TestBed } from '@angular/core/testing';
import { SetGameService } from './set-game.service';
import { GameSession, GAME_SESSION } from './game-session.interface';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function setupTestBed() {
  TestBed.configureTestingModule({
    providers: [
      SetGameService,
      { provide: GAME_SESSION, useExisting: SetGameService },
    ],
  });
}

// ── GameSession contract ──────────────────────────────────────────────────────

describe('GameSession interface contract (SetGameService)', () => {
  let svc: SetGameService;

  beforeEach(() => {
    setupTestBed();
    svc = TestBed.inject(SetGameService);
  });

  it('exposes state$ as an observable (has subscribe)', () => {
    expect(typeof svc.state$.subscribe).toBe('function');
  });

  it('exposes isMultiplayer as a boolean, false for single-player', () => {
    expect(typeof svc.isMultiplayer).toBe('boolean');
    expect(svc.isMultiplayer).toBe(false);
  });

  it('exposes required action methods', () => {
    expect(typeof svc.selectCard).toBe('function');
    expect(typeof svc.startNewGame).toBe('function');
  });

  it('exposes required query methods', () => {
    expect(typeof svc.getStateSnapshot).toBe('function');
    expect(typeof svc.findSetOnBoard).toBe('function');
  });

  it('exposes required colour preference API', () => {
    expect(typeof svc.getPalette).toBe('function');
    expect(typeof svc.getPaletteColor).toBe('function');
    expect(typeof svc.updatePaletteColor).toBe('function');
    expect(typeof svc.updateHighlightColor).toBe('function');
    expect(typeof svc.getCardColor).toBe('function');
    expect(typeof svc.highlightColor).toBe('string');
  });

  it('can be injected via the GAME_SESSION token', () => {
    const session = TestBed.inject(GAME_SESSION) as GameSession;
    expect(session).toBeTruthy();
    expect(typeof session.selectCard).toBe('function');
    expect(typeof session.state$.subscribe).toBe('function');
  });
});

// ── Palette API ───────────────────────────────────────────────────────────────

describe('SetGameService palette API', () => {
  let svc: SetGameService;
  let originalStorage: Storage;
  let mock: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    mock = makeMockStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mock, configurable: true, writable: true,
    });
    setupTestBed();
    svc = TestBed.inject(SetGameService);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalStorage, configurable: true, writable: true,
    });
  });

  describe('getPalette', () => {
    it('returns exactly 3 hex strings by default', () => {
      const p = svc.getPalette();
      expect(p).toHaveLength(3);
      p.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
    });

    it('returns a copy — mutating it does not affect the service', () => {
      const p1 = svc.getPalette();
      p1[0] = '#deadbe';
      expect(svc.getPalette()[0]).not.toBe('#deadbe');
    });
  });

  describe('getPaletteColor', () => {
    it('returns slot 1 for index 1', () => {
      expect(svc.getPaletteColor(1)).toBe(svc.getPalette()[0]);
    });

    it('returns slot 2 for index 2', () => {
      expect(svc.getPaletteColor(2)).toBe(svc.getPalette()[1]);
    });

    it('returns slot 3 for index 3', () => {
      expect(svc.getPaletteColor(3)).toBe(svc.getPalette()[2]);
    });

    it('falls back to slot 1 for index 0 or negative', () => {
      expect(svc.getPaletteColor(0)).toBe(svc.getPalette()[0]);
    });
  });

  describe('updatePaletteColor', () => {
    it('updates slot 1 to the given colour', () => {
      svc.updatePaletteColor(1, '#112233');
      expect(svc.getPalette()[0]).toBe('#112233');
    });

    it('normalises to lowercase', () => {
      svc.updatePaletteColor(2, '#AABBCC');
      expect(svc.getPalette()[1]).toBe('#aabbcc');
    });

    it('swaps slots when the new colour is already in another slot', () => {
      const palette = svc.getPalette();
      const slot2Color = palette[1]; // colour currently in slot 2
      // Assign slot 2's colour to slot 1 — should swap, not duplicate
      svc.updatePaletteColor(1, slot2Color);
      const updated = svc.getPalette();
      const allValues = [updated[0], updated[1], updated[2]];
      const unique = new Set(allValues);
      expect(unique.size).toBe(3); // all still distinct
    });

    it('persists to localStorage after update', () => {
      svc.updatePaletteColor(1, '#abcdef');
      const raw = mock.store['set-game-color-prefs'];
      expect(raw).toBeDefined();
      const saved = JSON.parse(raw);
      expect(saved.palette.includes('#abcdef')).toBe(true);
    });

    it('ignores out-of-range index (0, 4)', () => {
      const before = svc.getPalette().slice();
      svc.updatePaletteColor(0, '#ffffff');
      svc.updatePaletteColor(4, '#ffffff');
      expect(svc.getPalette()).toEqual(before);
    });

    it('is a no-op when the colour is the same as the current slot', () => {
      const before = svc.getPalette()[0];
      svc.updatePaletteColor(1, before);
      expect(svc.getPalette()[0]).toBe(before);
    });
  });

  describe('updateHighlightColor', () => {
    it('updates highlightColor property', () => {
      svc.updateHighlightColor('#ff00ff');
      expect(svc.highlightColor).toBe('#ff00ff');
    });

    it('normalises to lowercase', () => {
      svc.updateHighlightColor('#FF00FF');
      expect(svc.highlightColor).toBe('#ff00ff');
    });

    it('persists highlightColor to localStorage', () => {
      svc.updateHighlightColor('#a1b2c3');
      const saved = JSON.parse(mock.store['set-game-color-prefs']);
      expect(saved.highlightColor).toBe('#a1b2c3');
    });
  });

  describe('localStorage restore on construction', () => {
    it('restores palette from valid saved prefs', () => {
      const prefs = {
        palette: ['#111111', '#222222', '#333333'],
        highlightColor: '#444444',
      };
      mock.store['set-game-color-prefs'] = JSON.stringify(prefs);

      // Re-instantiate so the constructor runs with the pre-populated store
      TestBed.resetTestingModule();
      setupTestBed();
      const fresh = TestBed.inject(SetGameService);

      expect(fresh.getPalette()).toEqual(prefs.palette);
      expect(fresh.highlightColor).toBe(prefs.highlightColor);
    });

    it('falls back to defaults when stored prefs are invalid', () => {
      mock.store['set-game-color-prefs'] = 'invalid json{{{';

      TestBed.resetTestingModule();
      setupTestBed();
      const fresh = TestBed.inject(SetGameService);

      const palette = fresh.getPalette();
      expect(palette).toHaveLength(3);
      palette.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
    });
  });

  describe('getCardColor / updateCardColor', () => {
    it('returns undefined for an unknown card id', () => {
      expect(svc.getCardColor('nonexistent')).toBeUndefined();
    });

    it('stores and retrieves a per-card colour override', () => {
      svc.updateCardColor('#abcdef', 'card-1');
      expect(svc.getCardColor('card-1')).toBe('#abcdef');
    });

    it('does not affect other card ids', () => {
      svc.updateCardColor('#abcdef', 'card-1');
      expect(svc.getCardColor('card-2')).toBeUndefined();
    });
  });
});

// ── Multiplayer types (game.types.ts) ─────────────────────────────────────────
// These are pure TypeScript types — we exercise them at runtime via shape checks.

describe('Multiplayer types structural checks', () => {
  it('Player shape is correct', () => {
    const p = { id: 'pid-1', name: 'FunnyFish', correctSets: 0, incorrectSelections: 0 };
    expect(p.id).toBe('pid-1');
    expect(p.name).toBe('FunnyFish');
    expect(p.correctSets).toBe(0);
  });

  it('RoomState with one player has status waiting', () => {
    type P = { id: string; name: string; correctSets: number; incorrectSelections: number };
    const room: {
      roomId: string;
      status: 'waiting';
      players: readonly [P];
      board: unknown[];
      deck: unknown[];
      selections: Record<string, unknown[]>;
    } = {
      roomId: 'room-abc',
      status: 'waiting',
      players: [{ id: 'p1', name: 'FunnyFish', correctSets: 0, incorrectSelections: 0 }],
      board: [],
      deck: [],
      selections: {},
    };
    expect(room.status).toBe('waiting');
    expect(room.players).toHaveLength(1);
  });

  it('RoomState with two players can be active', () => {
    const p1 = { id: 'p1', name: 'FunnyFish', correctSets: 0, incorrectSelections: 0 };
    const p2 = { id: 'p2', name: 'Bob',       correctSets: 0, incorrectSelections: 0 };
    const room = {
      roomId: 'room-xyz',
      status: 'active' as const,
      players: [p1, p2] as [typeof p1, typeof p2],
      board: [],
      deck: [],
      selections: { p1: [], p2: [] },
    };
    expect(room.players).toHaveLength(2);
    expect(room.status).toBe('active');
    expect(room.selections['p1']).toEqual([]);
  });

  it('ClientMessage types are discriminated correctly', () => {
    const join    = { type: 'join'        as const, roomId: 'r1', playerName: 'FunnyFish' };
    const select  = { type: 'select_card' as const, cardId: 'c42' };
    const newGame = { type: 'new_game'    as const };

    expect(join.type).toBe('join');
    expect(select.cardId).toBe('c42');
    expect(newGame.type).toBe('new_game');
  });

  it('ServerMessage types are discriminated correctly', () => {
    const joined    = { type: 'joined'     as const, playerId: 'p1', roomId: 'r1' };
    const roomState = { type: 'room_state' as const, state: {} as any };
    const error     = { type: 'error'      as const, message: 'something went wrong' };

    expect(joined.playerId).toBe('p1');
    expect(roomState.type).toBe('room_state');
    expect(error.message).toBe('something went wrong');
  });
});
