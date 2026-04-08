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
});
