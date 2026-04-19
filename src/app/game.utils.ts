import { Card, Attr, BOARD_SIZE } from './game.types';

// Create all 81 unique cards
export function generateDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (let number = 1 as Attr; number <= 3; number = (number + 1) as Attr) {
    for (let color = 1 as Attr; color <= 3; color = (color + 1) as Attr) {
      for (let shape = 1 as Attr; shape <= 3; shape = (shape + 1) as Attr) {
        for (let shading = 1 as Attr; shading <= 3; shading = (shading + 1) as Attr) {
          deck.push({
            id: `c${id++}`,
            number,
            color,
            shape,
            shading,
          });
        }
      }
    }
  }
  return deck;
}

// Fisher-Yates shuffle
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// Check if three values are all same or all different
export function allSameOrAllDifferent(x: Attr, y: Attr, z: Attr): boolean {
  return (x === y && y === z) || (x !== y && x !== z && y !== z);
}

/** Inner check — assumes all three cards are already valid. Used by findSet for speed. */
function isSetTrusted(a: Card, b: Card, c: Card): boolean {
  return (
    allSameOrAllDifferent(a.number, b.number, c.number) &&
    allSameOrAllDifferent(a.color, b.color, c.color) &&
    allSameOrAllDifferent(a.shape, b.shape, c.shape) &&
    allSameOrAllDifferent(a.shading, b.shading, c.shading)
  );
}

export function isSet(a: Card, b: Card, c: Card): boolean {
  // Validate inputs: they must be objects with the four attributes
  if (!isValidCard(a) || !isValidCard(b) || !isValidCard(c)) return false;
  return isSetTrusted(a, b, c);
}

export function isValidAttr(x: unknown): x is Attr {
  return x === 1 || x === 2 || x === 3;
}

export function isValidCard(c: unknown): c is Card {
  if (c == null || typeof c !== 'object') return false;
  const r = c as Record<string, unknown>;
  return (
    isValidAttr(r['number']) &&
    isValidAttr(r['color']) &&
    isValidAttr(r['shape']) &&
    isValidAttr(r['shading'])
  );
}

/**
 * Given two attribute values, return the value that completes a valid set.
 * If a === b, the third must also be a (all same).
 * If a !== b, the third must be the remaining value (all different): 6 - a - b.
 */
function thirdAttr(a: Attr, b: Attr): Attr {
  return a === b ? a : (6 - a - b) as Attr;
}

/**
 * Find a set on the board in O(n²) time.
 *
 * For every pair (i, j) the required third card is fully determined —
 * each attribute must be whichever value makes it all-same or all-different.
 * We build a lookup map of cardId → index once, then each pair is O(1).
 *
 * Returns the indices [i, j, k] of the first set found, or null.
 */
export function findSet(board: Card[]): [number, number, number] | null {
  // Map canonical card id to board index for O(1) existence checks.
  // Card ids from generateDeck are stable strings like "c0"…"c80".
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < board.length; i++) {
    idToIndex.set(board[i].id, i);
  }

  const n = board.length;
  for (let i = 0; i < n - 1; i++) {
    const a = board[i];
    for (let j = i + 1; j < n; j++) {
      const b = board[j];
      // Compute the unique third card that would complete the set.
      const cn = thirdAttr(a.number, b.number);
      const cc = thirdAttr(a.color,  b.color);
      const cs = thirdAttr(a.shape,  b.shape);
      const ch = thirdAttr(a.shading, b.shading);
      // Derive the deterministic id that generateDeck assigns to this card.
      // generateDeck iterates number→color→shape→shading all from 1..3,
      // so index = (n-1)*27 + (c-1)*9 + (s-1)*3 + (h-1).
      const idx = (cn - 1) * 27 + (cc - 1) * 9 + (cs - 1) * 3 + (ch - 1);
      const candidateId = `c${idx}`;
      const k = idToIndex.get(candidateId);
      if (k !== undefined && k !== i && k !== j) {
        return [i, j, k];
      }
    }
  }
  return null;
}

/**
 * Apply a found set to the board and deck, returning a new board and deck.
 * Shared between single-player (game.service.ts) and server (ws-server.ts).
 *
 * Rules:
 *  - If the board is at standard size and the deck has cards, replace the 3
 *    removed cards in-place so positions stay stable.
 *  - If the board is extended (>12) or the deck is empty, remove the 3 cards
 *    and let the board drain toward 12.
 *  - In either case, if no set remains after the above, deal 3 cards at a time
 *    until a set appears or the deck is exhausted.
 */
export function applyFoundSet(
  board: Card[],
  deck: Card[],
  setIds: Set<string>,
): { board: Card[]; deck: Card[] } {
  board = board.slice();
  deck = deck.slice();

  if (board.length <= BOARD_SIZE && deck.length > 0) {
    for (let i = 0; i < board.length; i++) {
      if (setIds.has(board[i].id)) {
        board[i] = deck.shift()!;
      }
    }
  } else {
    board = board.filter((c) => !setIds.has(c.id));
  }

  while (findSet(board) === null && deck.length >= 3) {
    board.push(deck.shift()!);
    board.push(deck.shift()!);
    board.push(deck.shift()!);
  }

  return { board, deck };
}

/**
 * Shuffle the full deck and deal an initial board, adding extra cards one at
 * a time (per official rules) until a valid set is present or the deck runs out.
 *
 * Returns the dealt board and the remaining deck.
 * Used by both `initGame()` (single-player) and the WebSocket server.
 */
export function dealInitialBoard(): { board: Card[]; deck: Card[] } {
  const full = shuffle(generateDeck());
  const board = full.slice(0, BOARD_SIZE);
  const deck  = full.slice(BOARD_SIZE);
  while (findSet(board) === null && deck.length > 0) {
    board.push(deck.shift()!);
  }
  return { board, deck };
}

// ── Presentation helpers ───────────────────────────────────────────────────

const SHAPES   = ['pill', 'diamond', 'squiggle'] as const;
const SHADINGS = ['solid', 'striped', 'outline'] as const;

/** Map a card's numeric shape attribute (1–3) to its display name. */
export function shapeFor(c: Card): string {
  return SHAPES[c.shape - 1] ?? 'pill';
}

/** Map a card's numeric shading attribute (1–3) to its display name. */
export function shadingFor(c: Card): string {
  return SHADINGS[c.shading - 1] ?? 'solid';
}

/**
 * Generate a short anonymous display name for first-time visitors and persist
 * it to localStorage so the same name is shown when re-opening the page.
 * Safe to call only in a browser context (localStorage is not available on the server).
 */
export function generateDefaultPlayerName(): string {
  const adjectives = ['Funny', 'Swag', 'Epic', 'Clever', 'Fast'];
  const nouns = ['Horse', 'Shark', 'Bear', 'Fish', 'Snoopy'];
  const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const name = `${adj}${noun}`;
  try { localStorage.setItem('playerName', name); } catch { /* SSR / private-mode no-op */ }
  return name;
}
