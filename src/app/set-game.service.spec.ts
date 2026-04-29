import { TestBed } from '@angular/core/testing';
import { SetGameService } from './set-game.service';

describe('SetGameService', () => {
  let service: SetGameService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SetGameService);
  });

  it('starts with an initial state', () => {
    const s = service.getStateSnapshot();
    expect(s.board.length).toBeGreaterThanOrEqual(12);
    expect(s.selected.length).toBe(0);
    expect(typeof s.correctSets).toBe('number');
    expect(typeof s.incorrectSelections).toBe('number');
  });

  it('startNewGame replaces state', () => {
    const old = service.getStateSnapshot();
    service.startNewGame();
    const neu = service.getStateSnapshot();
    expect(neu).not.toBe(old);
    expect(neu.board.length).toBeGreaterThanOrEqual(12);
  });

  it('selectCard updates selection and applies set if valid', () => {
    service.startNewGame();
    const s = service.getStateSnapshot();
    // pick three cards from board (may or may not be a set)
    const a = s.board[0];
    const b = s.board[1];
    const c = s.board[2];

    service.selectCard(a);
    let snap = service.getStateSnapshot();
    expect(snap.selected.length).toBe(1);

    service.selectCard(b);
    snap = service.getStateSnapshot();
    expect(snap.selected.length).toBe(2);

    service.selectCard(c);
    snap = service.getStateSnapshot();
    // after third selection either selection cleared (if invalid) or cleared and score incremented
    expect(snap.selected.length).toBe(0);
  });

  it('applySet updates board and score', () => {
    service.startNewGame();
    const s = service.getStateSnapshot();
    const sel = s.board.slice(0, 3);
    const beforeCorrect = s.correctSets;
    const applied = service.applySet(sel as any);
    const after = service.getStateSnapshot();
    expect(after.selected.length).toBe(0);
    if (applied) {
      expect(after.correctSets).toBe(beforeCorrect + 1);
    } else {
      expect(after.correctSets).toBe(beforeCorrect);
    }
  });
});
