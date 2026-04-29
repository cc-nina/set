import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, of, Subject, merge, map, delay } from 'rxjs';
import { Card, GameState, Player, PlayerId, LAST_SET_BANNER_MS, GameEvent } from './game.types';
import * as core from './game.service';
import { findSet } from './game.utils';
import { GameSession } from './game-session.interface';
import { ColorPrefsService } from './color-prefs.service';
import { loadGameState, saveGameState } from './game-state.storage';
import { SERVER_ORIGIN } from './server.config';

@Injectable({ providedIn: 'root' })
export class SetGameService implements GameSession {
  readonly isMultiplayer = false;
  readonly requiresCallSet = false;

  private stateSubject: BehaviorSubject<GameState>;
  public state$: Observable<GameState>;

  /**
   * Single-player has no real opponent list.
   * Emits a single anonymous local player so consumers never need to null-check.
   */
  readonly players$: Observable<Player[]> = of([
    { id: 'local', name: 'You', colorIndex: 0, correctSets: 0, incorrectSelections: 0, connected: true },
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

  /**
   * Emits 'local' immediately after an incorrect 3-card selection (neg), then
   * null after the animation window. Drives the shake+remove animation.
   */
  private negSetBySource = new Subject<PlayerId>();
  readonly negSetBy$: Observable<PlayerId | null> = merge(
    this.negSetBySource.pipe(map((id): PlayerId | null => id)),
    this.negSetBySource.pipe(delay(LAST_SET_BANNER_MS), map((): PlayerId | null => null)),
  );

  /** Single-player games have no event feed. This is an empty stream. */
  readonly events$: Observable<GameEvent> = of();

  /**
   * Single-player: the call-SET lock is managed entirely in the component
   * (local countdown). This stream always emits null so the interface is
   * satisfied; the component ignores it for single-player.
   */
  readonly callerLockId$: Observable<PlayerId | null> = of(null);

  private currentGame: { gameId: number; startedAt: number } | null = null;
  // True when a game is in progress but startGameRecord() hasn't been called yet.
  // Deferred until the first selectCard so that page loads that never reach /game
  // don't pollute solo stats.
  private pendingInitialRecord = false;

  private static readonly RECORD_KEY = 'set-solo-record';

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    public colorPrefs: ColorPrefsService,
  ) {
    const saved = isPlatformBrowser(this.platformId) ? loadGameState() : null;
    this.stateSubject = new BehaviorSubject<GameState>(saved ?? core.initGame());
    this.state$ = this.stateSubject.asObservable();
    if (isPlatformBrowser(this.platformId)) {
      this.stateSubject.subscribe(state => {
        saveGameState(state);
        if (state.status === 'finished' && this.currentGame !== null) {
          this.endGameRecord(state.correctSets);
        }
      });
      if (saved?.status === 'active') {
        // Resume an in-progress game: reconnect to the existing DB row so a
        // page refresh doesn't create a duplicate start record.
        try {
          const raw = localStorage.getItem(SetGameService.RECORD_KEY);
          const r = raw ? JSON.parse(raw) as { gameId: number; startedAt: number } : null;
          if (r && typeof r.gameId === 'number') {
            this.currentGame = { gameId: r.gameId, startedAt: r.startedAt ?? Date.now() };
          } else {
            this.pendingInitialRecord = true;
          }
        } catch {
          this.pendingInitialRecord = true;
        }
      } else {
        // No saved state or finished game — clear any stale record key.
        localStorage.removeItem(SetGameService.RECORD_KEY);
        if (!saved) this.pendingInitialRecord = true;
      }
    }
  }

  private async startGameRecord(): Promise<void> {
    try {
      const res = await fetch(`${SERVER_ORIGIN}/api/start-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'solo' }),
      });
      if (!res.ok) return;
      const { gameId } = await res.json() as { gameId: number };
      if (typeof gameId !== 'number') return;
      this.currentGame = { gameId, startedAt: Date.now() };
      try { localStorage.setItem(SetGameService.RECORD_KEY, JSON.stringify(this.currentGame)); } catch { /* non-fatal */ }
    } catch { /* non-fatal */ }
  }

  private endGameRecord(score: number): void {
    if (this.currentGame === null) return;
    const { gameId, startedAt } = this.currentGame;
    this.currentGame = null;
    try { localStorage.removeItem(SetGameService.RECORD_KEY); } catch { /* non-fatal */ }
    fetch(`${SERVER_ORIGIN}/api/end-game/${gameId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_ms: Date.now() - startedAt, score }),
    }).catch(() => {});
  }

  // ── GameSession interface — colour prefs delegated to ColorPrefsService ──

  get highlightColor(): string                        { return this.colorPrefs.highlightColor; }
  getPalette(): string[]                              { return this.colorPrefs.getPalette(); }
  getPaletteColor(index: number): string              { return this.colorPrefs.getPaletteColor(index); }
  updatePaletteColor(index: number, color: string)    { this.colorPrefs.updatePaletteColor(index, color); }
  updateHighlightColor(color: string)                 { this.colorPrefs.updateHighlightColor(color); }
  getCardColor(cardId: string): string | undefined    { return this.colorPrefs.getCardColor(cardId); }
  updateCardColor(color: string, cardId?: string): void {
    const boardCardIds = cardId ? undefined : this.getStateSnapshot().board.map(c => c.id);
    this.colorPrefs.updateCardColor(color, cardId, boardCardIds);
  }

  // ── Game actions ──────────────────────────────────────────────────────────

  getStateSnapshot(): GameState {
    return this.stateSubject.getValue();
  }

  startNewGame(): void {
    this.endGameRecord(this.getStateSnapshot().correctSets);
    void this.startGameRecord();
    this.colorPrefs.clearCardColors();
    const s = core.initGame();
    this.stateSubject.next(s);
  }

  /** Single-player: the call-SET lock is handled by the component locally.
   * This method is a no-op; the component's own callSet() drives the timer.
   */
  callSet(): void { /* handled client-side for single-player */ }

  /**
   * Single-player: penalise and clear the partial selection when the local
   * countdown expires.  This mirrors the multiplayer server behaviour: a
   * timeout counts as an incorrect selection (−1 point).
   *
   * Takes a snapshot of the selected cards first to avoid re-reading state
   * mid-loop — if 3 cards happened to be selected, toggling the 3rd would
   * trigger set evaluation inside selectCard(), mutating the subject before
   * the forEach finishes. Snapshotting prevents that race.
   */
  clearSelectionOnCancel(): void {
    const prev = this.getStateSnapshot();

    // Deselect all currently selected cards.
    const toDeselect = prev.selected.slice();
    toDeselect.forEach(c => this.selectCard(c));

    // Apply the timeout penalty (same as an incorrect selection).
    const after = this.getStateSnapshot();
    const penalised: GameState = {
      ...after,
      incorrectSelections: after.incorrectSelections + 1,
      lastNegCardIds: null,
    };
    this.stateSubject.next(penalised);
    this.negSetBySource.next('local');
  }

  selectCard(card: Card): void {
    if (this.pendingInitialRecord) {
      this.pendingInitialRecord = false;
      void this.startGameRecord();
    }
    const prev = this.getStateSnapshot();
    const next = core.selectCard(prev, card);
    this.stateSubject.next(next);
    // Fire the match signal when a correct set was just applied.
    if (next.correctSets > prev.correctSets) {
      this.lastSetBySource.next('local');
    }
    // Fire the neg signal when an incorrect 3-card selection was just penalised.
    if (next.incorrectSelections > prev.incorrectSelections) {
      this.negSetBySource.next('local');
    }
  }

  applySet(selected: Card[]): boolean {
    // Not part of GameSession — single-player implementation detail.
    // Exposed publicly only so unit tests can drive it directly.
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