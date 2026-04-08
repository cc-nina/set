import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Card, GameState } from './game.types';
import * as core from './game.service';
import { findSet } from './game.utils';

@Injectable({ providedIn: 'root' })
export class SetGameService {
  private stateSubject: BehaviorSubject<GameState>;
  public state$: Observable<GameState>;

  // Per-card colour overrides (id -> hex)
  private cardColors: Record<string, string> = {};

  // Palette for numeric colour attribute (index 1..3). Always exactly 3 entries.
  private palette: string[] = ['#cc0000', '#0aa64a', '#5a2ea6'];

  constructor() {
    const initial = core.initGame();
    this.stateSubject = new BehaviorSubject<GameState>(initial);
    this.state$ = this.stateSubject.asObservable();
  }

  getStateSnapshot(): GameState {
    return this.stateSubject.getValue();
  }

  startNewGame(): void {
    const s = core.initGame();
    this.stateSubject.next(s);
  }

  selectCard(card: Card): void {
    const next = core.selectCard(this.getStateSnapshot(), card);
    this.stateSubject.next(next);
  }

  applySet(selected: Card[]): boolean {
    try {
      const next = core.applySet(this.getStateSnapshot(), selected);
      this.stateSubject.next(next);
      return true;
    } catch {
      return false;
    }
  }

  findSetOnBoard(): [number, number, number] | null {
    return findSet(this.getStateSnapshot().board);
  }

  updateCardColor(color: string, cardId?: string): void {
    if (cardId) {
      this.cardColors[cardId] = color;
    } else {
      this.getStateSnapshot().board.forEach((c) => (this.cardColors[c.id] = color));
    }
  }

  getCardColor(cardId: string): string | undefined {
    return this.cardColors[cardId];
  }

  // ── Palette API ──────────────────────────────────────────────────────────────

  getPalette(): string[] {
    return this.palette.slice(0, 3);
  }

  getPaletteColor(index: number): string {
    if (!index || index < 1) return this.palette[0];
    return this.palette[(index - 1) % 3] || this.palette[0];
  }

  /**
   * Update palette slot `index` (1-based) to `color`.
   * If the colour already exists in another slot the two slots are swapped,
   * keeping all three values distinct.
   */
  updatePaletteColor(index: number, color: string): void {
    if (!index || index < 1 || index > 3) return;

    const normalized = (color || '').toLowerCase();
    const pos = index - 1;

    if (this.palette[pos] === normalized) return;

    // Swap if the colour is already used elsewhere
    const other = this.palette.findIndex((c, i) => i !== pos && c === normalized);
    if (other >= 0) {
      const tmp = this.palette[other];
      this.palette[other] = this.palette[pos];
      this.palette[pos] = tmp;
      return;
    }

    this.palette[pos] = normalized;
  }
}