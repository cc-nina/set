import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';
import { Card, GameState } from './game.types';
import * as core from './game.service';
import { findSet } from './game.utils';
import { loadColorPrefs, saveColorPrefs } from './color-prefs.storage';

const DEFAULT_PALETTE: [string, string, string] = ['#cc0000', '#0aa64a', '#5a2ea6'];
const DEFAULT_HIGHLIGHT = '#000000';

@Injectable({ providedIn: 'root' })
export class SetGameService {
  private stateSubject: BehaviorSubject<GameState>;
  public state$: Observable<GameState>;

  // Per-card colour overrides (id -> hex)
  private cardColors: Record<string, string> = {};

  // Palette for numeric colour attribute (index 1..3). Always exactly 3 entries.
  private palette: [string, string, string];

  /** Persisted highlight colour — loaded at boot, kept in sync by the component. */
  highlightColor: string;

  constructor(@Inject(PLATFORM_ID) private platformId: object) {
    // ── Load persisted colour prefs ─────────────────────────────────────────
    const saved = isPlatformBrowser(this.platformId) ? loadColorPrefs() : null;
    this.palette = saved ? [...saved.palette] as [string, string, string] : [...DEFAULT_PALETTE] as [string, string, string];
    this.highlightColor = saved?.highlightColor ?? DEFAULT_HIGHLIGHT;

    const initial = core.initGame();
    this.stateSubject = new BehaviorSubject<GameState>(initial);
    this.state$ = this.stateSubject.asObservable();
  }

  /** Persist the current palette + highlight colour to localStorage. */
  private savePrefs(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    saveColorPrefs({
      palette: [...this.palette] as [string, string, string],
      highlightColor: this.highlightColor,
    });
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
    } else {
      this.palette[pos] = normalized;
    }

    this.savePrefs();
  }

  /** Update the selection highlight colour and persist. */
  updateHighlightColor(color: string): void {
    this.highlightColor = color.toLowerCase();
    this.savePrefs();
  }
}