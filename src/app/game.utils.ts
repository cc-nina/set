import { Card, Attr } from './game.types';

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
