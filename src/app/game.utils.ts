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

export function isSet(a: Card, b: Card, c: Card): boolean {
  // Validate inputs quickly: they must be objects with the four attributes
  if (!isValidCard(a) || !isValidCard(b) || !isValidCard(c)) return false;

  return (
    allSameOrAllDifferent(a.number, b.number, c.number) &&
    allSameOrAllDifferent(a.color, b.color, c.color) &&
    allSameOrAllDifferent(a.shape, b.shape, c.shape) &&
    allSameOrAllDifferent(a.shading, b.shading, c.shading)
  );
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

// Find a set on the board; returns indices of the set or null
export function findSet(board: Card[]): [number, number, number] | null {
  const n = board.length;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        if (isSet(board[i], board[j], board[k])) return [i, j, k];
      }
    }
  }
  return null;
}
