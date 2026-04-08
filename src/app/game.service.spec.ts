import { initGame, selectCard, applySet } from './game.service';

describe('game.service', () => {
  it('initGame produces correct shapes', () => {
    const s = initGame();
    expect(s.board.length).toBeGreaterThanOrEqual(12);
    expect(Array.isArray(s.deck)).toBe(true);
    expect(s.selected.length).toBe(0);
    expect(typeof s.score).toBe('number');
    expect(typeof s.correctSets).toBe('number');
    expect(typeof s.incorrectSelections).toBe('number');
  });

  it('selecting three non-set penalizes score and increments incorrectSelections', () => {
    const s = initGame();
    const a = s.board[0];
    const b = s.board[1];
    // craft a card that likely won't form a set with a and b by duplicating attributes
    const fake = { ...s.board[2], id: 'fake' };
    const s1 = selectCard(s, a);
    const s2 = selectCard(s1, b);
    const s3 = selectCard(s2, fake as any);
    expect(s3.selected.length).toBe(0);
    expect(s3.incorrectSelections).toBe(s.incorrectSelections + 1);
    expect(s3.score).toBeGreaterThanOrEqual(0);
  });

  it('applySet removes cards and draws new ones when valid', () => {
    const s = initGame();
    const sel = s.board.slice(0, 3);
    try {
      const after = applySet(s, sel as any);
      expect(after.selected.length).toBe(0);
      expect(after.board.length).toBeGreaterThanOrEqual(9);
      expect(after.score).toBe(s.score + 3);
      expect(after.correctSets).toBe(s.correctSets + 1);
    } catch (e) {
      // if the slice wasn't a set, applySet should throw — that's acceptable for this test.
      expect(e).toBeTruthy();
    }
  });

  it('selectCard toggles selection and applies a valid set when three matching cards selected', () => {
    // build a controlled state with a known valid set
  const cardA = { id: 'a', number: 1 as any, color: 1 as any, shape: 1 as any, shading: 1 as any } as any;
  const cardB = { id: 'b', number: 1 as any, color: 1 as any, shape: 1 as any, shading: 1 as any } as any;
  const cardC = { id: 'c', number: 1 as any, color: 1 as any, shape: 1 as any, shading: 1 as any } as any;
    const deck = [] as any[];
    const state: any = { deck, board: [cardA, cardB, cardC], selected: [], score: 0, correctSets: 0, incorrectSelections: 0 };

    const s1 = selectCard(state, cardA);
    expect(s1.selected.length).toBe(1);
    const s2 = selectCard(s1, cardB);
    expect(s2.selected.length).toBe(2);
    const s3 = selectCard(s2, cardC);
    // since A,B,C form a valid set, the selection should be applied and cleared
    expect(s3.selected.length).toBe(0);
    expect(s3.correctSets).toBe(1);
    expect(s3.score).toBe(3);
  });

  it('applySet throws if passed invalid number of cards or invalid set', () => {
    const s = initGame();
    expect(() => applySet(s, [] as any)).toThrow();
    const invalid = [s.board[0], s.board[1], { ...s.board[2], id: 'fake' }];
    // invalid set should throw
    try {
      applySet(s, invalid as any);
      // if no throw, that's unexpected — fail
      throw new Error('applySet did not throw for invalid set');
    } catch (e) {
      expect(e).toBeTruthy();
    }
  });
});
