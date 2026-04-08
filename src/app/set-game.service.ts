import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Card, GameState } from './game.types';
import * as core from './game.service';
import { findSet } from './game.utils';

@Injectable({ providedIn: 'root' })
export class SetGameService {
  private stateSubject: BehaviorSubject<GameState>;
  public state$: Observable<GameState>;
  // simple in-memory map for card colors (id -> hex)
  private cardColors: Record<string, string> = {};

  constructor() {
    // initialize with a fresh game
    const initial = core.initGame();
    this.stateSubject = new BehaviorSubject<GameState>(initial);
    this.state$ = this.stateSubject.asObservable();
  }

  // Helper to get current snapshot
  getStateSnapshot(): GameState {
    return this.stateSubject.getValue();
  }

  // Start a new game
  startNewGame(): void {
    const s = core.initGame();
    this.stateSubject.next(s);
  }

  // Select or deselect a card; pushes next state
  selectCard(card: Card): void {
    const current = this.getStateSnapshot();
    const next = core.selectCard(current, card);
    this.stateSubject.next(next);
  }

  // Apply a set (useful if UI has identified a set)
  // Apply a set; validates first. Returns true if applied, false otherwise.
  applySet(selected: Card[]): boolean {
    const current = this.getStateSnapshot();
    try {
      const next = core.applySet(current, selected);
      this.stateSubject.next(next);
      return true;
    } catch (e) {
      // invalid set - do not change state
      return false;
    }
  }

  // Expose a helper to find a set on the current board
  findSetOnBoard(): [number, number, number] | null {
    const board = this.getStateSnapshot().board;
    return findSet(board);
  }

  // Allow updating a color for a specific card id, or a global color when id is undefined.
  updateCardColor(color: string, cardId?: string): void {
    if (cardId) this.cardColors[cardId] = color;
    else {
      // apply to all known cards on board
      const board = this.getStateSnapshot().board;
      board.forEach((c) => (this.cardColors[c.id] = color));
    }
  }

  getCardColor(cardId: string): string | undefined {
    return this.cardColors[cardId];
  }
}
