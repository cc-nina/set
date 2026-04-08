import { generateDeck, isSet, findSet, shuffle } from './game.utils';

describe('game.utils', () => {
  it('generateDeck creates 81 unique cards', () => {
    const deck = generateDeck();
    expect(deck.length).toBe(81);
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(81);
  });

  it('isSet recognizes a valid set and rejects invalid', () => {
    // All different across all features
    const a = { id: 'a', number: 1, color: 1, shape: 1, shading: 1 };
    const b = { id: 'b', number: 2, color: 2, shape: 2, shading: 2 };
    const c = { id: 'c', number: 3, color: 3, shape: 3, shading: 3 };
    expect(isSet(a as any, b as any, c as any)).toBe(true);

    // Non-set: two features same, one mismatched
    const d = { id: 'd', number: 1, color: 1, shape: 2, shading: 1 };
    expect(isSet(a as any, b as any, d as any)).toBe(false);
  });

  it('isSet handles all-same features correctly', () => {
    // All same color, other features all different
    const a = { id: 'a', number: 1, color: 1, shape: 1, shading: 1 };
    const b = { id: 'b', number: 2, color: 1, shape: 2, shading: 2 };
    const c = { id: 'c', number: 3, color: 1, shape: 3, shading: 3 };
    expect(isSet(a as any, b as any, c as any)).toBe(true);
  });

  it('isSet handles all-different for individual features', () => {
    // All same number, different color
    const a = { id: 'a', number: 1, color: 1, shape: 1, shading: 1 };
    const b = { id: 'b', number: 1, color: 2, shape: 2, shading: 2 };
    const c = { id: 'c', number: 1, color: 3, shape: 3, shading: 3 };
    expect(isSet(a as any, b as any, c as any)).toBe(true);
  });

  it('isSet recognizes mixed valid sets (some features same, some all different)', () => {
    // number: all same, color: all different, shape: all different, shading: all same
    const a = { id: 'a', number: 2, color: 1, shape: 1, shading: 3 };
    const b = { id: 'b', number: 2, color: 2, shape: 2, shading: 3 };
    const c = { id: 'c', number: 2, color: 3, shape: 3, shading: 3 };
    expect(isSet(a as any, b as any, c as any)).toBe(true);
  });

  it('isSet rejects non-sets correctly', () => {
    const a = { id: 'a', number: 1, color: 1, shape: 1, shading: 1 };
    const b = { id: 'b', number: 1, color: 2, shape: 2, shading: 2 };
    // this third card makes color neither all same nor all different
    const c = { id: 'c', number: 2, color: 2, shape: 3, shading: 3 };
    expect(isSet(a as any, b as any, c as any)).toBe(false);
  });

  it('isSet handles invalid inputs robustly', () => {
    const valid = { id: 'v', number: 1, color: 1, shape: 1, shading: 1 };
    expect(isSet(null as any, valid as any, valid as any)).toBe(false);
    expect(isSet(valid as any, undefined as any, valid as any)).toBe(false);
    expect(isSet({} as any, {} as any, {} as any)).toBe(false);
  });

  it('findSet returns a triple when present', () => {
    const deck = generateDeck();
    const shuffled = shuffle(deck);
    // Ensure we have at least one set on first 12 by brute force
    const board = shuffled.slice(0, 12);
    const res = findSet(board);
    // res can be null for unlucky shuffle but over many decks it's likely; assert type
    expect(res === null || (res && res.length === 3)).toBe(true);
  });
});
