import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Card, GameState, Player, PlayerId, GameEvent } from './game.types';

/**
 * Contract that both LocalGameSession (single-player) and
 * MultiplayerGameSession (WebSocket-backed) must satisfy.
 *
 * GameBoardComponent depends only on this interface, never on a concrete
 * class, so the two implementations are interchangeable from the UI's
 * perspective.
 */
export interface GameSession {
  // ── State stream ──────────────────────────────────────────────────────────
  /**
   * Emits the latest GameState whenever anything changes.
   * Components subscribe here; they never mutate state directly.
   */
  readonly state$: Observable<GameState>;

  /**
   * Emits the current list of players in the session.
   * Single-player: always a one-element array containing the local player.
   * Multiplayer: both players once the room is active.
   */
  readonly players$: Observable<Player[]>;

  /**
   * Emits the PlayerId of whoever just completed a valid set, then null after
   * the highlight window expires. Both players' UIs subscribe to this to show
   * a "Player X found a set!" banner.
   */
  readonly lastSetBy$: Observable<PlayerId | null>;

  /**
   * Emits a stream of discrete game events as they happen in a multiplayer
   * room, used to render the action feed.
   * Single-player: never emits.
   */
  readonly events$: Observable<GameEvent>;

  // ── Actions ───────────────────────────────────────────────────────────────
  /** Select or deselect a card. If it completes a valid set, the set is applied. */
  selectCard(card: Card): void;

  /** Tear down the current game and start a fresh one. */
  startNewGame(): void;

  /**
   * Claim the call-SET lock for the local player.
   * Single-player: handled entirely client-side (local countdown).
   * Multiplayer: sends a `call_set` message to the server; the server is
   * authoritative — it rejects the call if another player already holds the lock.
   */
  callSet(): void;

  /**
   * Called by GameBoardComponent when the call window expires locally
   * (countdown reaches zero) without a valid set being found.
   *
   * Single-player: toggles each selected card to deselect it (synchronous).
   * Multiplayer: no-op — the server broadcasts the penalty and clears the
   * selection via room_state, so no extra messages need to be sent.
   */
  clearSelectionOnCancel(): void;

  /**
   * Emits the PlayerId of whoever currently holds the call-SET lock, or null
   * when nobody has called. Used to disable the Call SET button for all other
   * players in multiplayer.
   * Single-player: always null (lock is managed locally, not via this stream).
   */
  readonly callerLockId$: Observable<PlayerId | null>;

  // ── Queries ───────────────────────────────────────────────────────────────
  /** Synchronous snapshot — use sparingly; prefer state$ for reactivity. */
  getStateSnapshot(): GameState;

  /** Returns the indices [i,j,k] of a valid set on the board, or null. */
  findSetOnBoard(): [number, number, number] | null;

  // Note: `applySet` is intentionally absent from this interface.
  // In single-player the service applies sets locally; in multiplayer the
  // server is authoritative — clients only call selectCard() and the server
  // decides whether to apply the set.

  // ── Colour preferences ────────────────────────────────────────────────────
  /** Returns the three card-colour hex strings (palette slots 1–3). */
  getPalette(): string[];

  /** Returns the hex colour for the given 1-based palette index. */
  getPaletteColor(index: number): string;

  /** Update palette slot `index` (1-based) to a new hex colour and persist. */
  updatePaletteColor(index: number, color: string): void;

  /** The selection-highlight hex colour. */
  readonly highlightColor: string;

  /** Update the selection-highlight colour and persist. */
  updateHighlightColor(color: string): void;

  /** Returns a per-card colour override, or undefined if none is set. */
  getCardColor(cardId: string): string | undefined;
}

/**
 * Angular DI token used to inject GameSession.
 * Components use this token instead of the concrete class so the
 * implementation can be swapped (local ↔ multiplayer) at the provider level.
 *
 * Usage in a component:
 *   constructor(@Inject(GAME_SESSION) private session: GameSession) {}
 *
 * Usage in providers:
 *   { provide: GAME_SESSION, useExisting: SetGameService }
 *   { provide: GAME_SESSION, useExisting: MultiplayerGameSession }
 */
export const GAME_SESSION = new InjectionToken<GameSession>('GameSession');
