import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, Subject, merge, map, delay } from 'rxjs';
import { Card, GameState, Player, PlayerId, LAST_SET_BANNER_MS, GameEvent } from './game.types';
import * as core from './game.service';
import { findSet } from './game.utils';
import { GameSession } from './game-session.interface';
import { ColorPrefsService } from './color-prefs.service';

@Injectable({ providedIn: 'root' })
export class SetGameService implements GameSession {
  private stateSubject: BehaviorSubject<GameState>;
  public state$: Observable<GameState>;

  /**
   * Single-player has no real opponent list.
   * Emits a single anonymous local player so consumers never need to null-check.
   */
  readonly players$: Observable<Player[]> = of([
    { id: 'local', name: 'You', score: 0, correctSets: 0, incorrectSelections: 0, connected: true },
  ]);

  /**
   * Emits 'local' immediately after a correct set is found, then null after
   * the banner window.  Drives the same match animation used in multiplayer.
   */
  private lastSetBySource = new Subject<PlayerId>();
  readonly lastSetBy$: Observable<PlayerId | null> = merge(
    this.lastSetBySource.pipe(map((id): PlayerId | null => id)),
    this.lastSetBySource.pipe(delay(LAST_SET_BANNER_MS), map((): PlayerId | null => null)),
  );

  /** Single-player games have no event feed. This is an empty stream. */
  readonly events$: Observable<GameEvent> = of();

  /**
   * Single-player: the call-SET lock is managed entirely in the component
   * (local countdown). This stream always emits null so the interface is
   * satisfied; the component ignores it for single-player.
   */
  readonly callerLockId$: Observable<PlayerId | null> = of(null);

  constructor(public colorPrefs: ColorPrefsService) {
    const initial = core.initGame();
    this.stateSubject = new BehaviorSubject<GameState>(initial);
    this.state$ = this.stateSubject.asObservable();
  }

  // ── GameSession interface — colour prefs delegated to ColorPrefsService ──

  get highlightColor(): string                        { return this.colorPrefs.highlightColor; }
  getPalette(): string[]                              { return this.colorPrefs.getPalette(); }
  getPaletteColor(index: number): string              { return this.colorPrefs.getPaletteColor(index); }
  updatePaletteColor(index: number, color: string)    { this.colorPrefs.updatePaletteColor(index, color); }
  updateHighlightColor(color: string)                 { this.colorPrefs.updateHighlightColor(color); }
  getCardColor(cardId: string): string | undefined    { return this.colorPrefs.getCardColor(cardId); }

  // ── Game actions ──────────────────────────────────────────────────────────

  getStateSnapshot(): GameState {
    return this.stateSubject.getValue();
  }

  startNewGame(): void {
    this.colorPrefs.clearCardColors();
    const s = core.initGame();
    this.stateSubject.next(s);
  }

  /** Single-player: the call-SET lock is handled by the component locally.
   * This method is a no-op; the component's own callSet() drives the timer.
   */
  callSet(): void { /* handled client-side for single-player */ }

  /**
   * Single-player: clear the partial selection when the local countdown expires.
   * Takes a snapshot of the selected cards first to avoid re-reading state
   * mid-loop — if 3 cards happened to be selected, toggling the 3rd would
   * trigger set evaluation inside selectCard(), mutating the subject before
   * the forEach finishes. Snapshotting prevents that race.
   */
  clearSelectionOnCancel(): void {
    const toDeselect = this.getStateSnapshot().selected.slice();
    toDeselect.forEach(c => this.selectCard(c));
  }

  selectCard(card: Card): void {
    const prev = this.getStateSnapshot();
    const next = core.selectCard(prev, card);
    this.stateSubject.next(next);
    // Fire the match signal when a correct set was just applied.
    if (next.correctSets > prev.correctSets) {
      this.lastSetBySource.next('local');
    }
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
}