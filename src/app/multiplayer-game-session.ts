/**
 * multiplayer-game-session.ts
 *
 * Angular service that connects to the WebSocket server, manages the
 * room lifecycle, and exposes the GameSession interface so GameBoardComponent
 * can render a multiplayer game without knowing anything about WebSockets.
 *
 * Lifecycle:
 *   1. GameRoomComponent creates this service in its providers array.
 *   2. GameRoomComponent calls connect(roomId, playerName, maxPlayers).
 *   3. On open the service checks localStorage for a saved (roomId, playerId).
 *      - If found and roomId matches → sends { type:'reconnect', ... }
 *      - Otherwise → sends { type:'join', ... }
 *   4. Server replies with 'joined' then 'room_state' messages.
 *   5. Every subsequent 'room_state' is mapped to a GameState and emitted on state$.
 *   6. GameBoardComponent subscribes to state$ and renders cards normally.
 *   7. When the user clicks a card, selectCard() sends { type:'select_card' } to the server.
 *   8. GameRoomComponent calls disconnect() / leave() on ngOnDestroy.
 */

import { Injectable, Inject, PLATFORM_ID, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  BehaviorSubject,
  Subject,
  Observable,
  distinctUntilChanged,
  map,
  delay,
  merge,
} from 'rxjs';
import { Card, GameState, Player, PlayerId, RoomState, ServerMessage, LAST_SET_BANNER_MS, GameEvent } from './game.types';
import { findSet } from './game.utils';
import { GameSession } from './game-session.interface';
import { ColorPrefsService } from './color-prefs.service';

// localStorage keys for reconnection (localStorage persists across tab closes,
// unlike sessionStorage which is cleared when the tab is closed — essential for
// the "close tab → reopen link" reconnection flow).
const SS_PLAYER_ID = 'mp_playerId';
const SS_ROOM_ID   = 'mp_roomId';

/** Empty GameState used as a placeholder before the server deals the board. */
function emptyState(): GameState {
  return { deck: [], board: [], selected: [], score: 0, correctSets: 0, incorrectSelections: 0, status: 'active' };
}

/**
 * Map a server RoomState to the GameState shape that GameBoardComponent expects.
 * The local player's selection becomes `selected`; score comes from the local player entry.
 */
function roomStateToGameState(rs: RoomState, playerId: PlayerId): GameState {
  const me = rs.players.find((p) => p.id === playerId);
  return {
    deck: rs.deck,
    board: rs.board,
    selected: rs.selections[playerId] ?? [],
    score: me?.score ?? 0,
    correctSets: me?.correctSets ?? 0,
    incorrectSelections: me?.incorrectSelections ?? 0,
    status: rs.status === 'finished' ? 'finished' : 'active',
    myPlayerId: playerId,
    players: rs.players,
  };
}

@Injectable()
export class MultiplayerGameSession implements GameSession, OnDestroy {
  // ── Public streams ────────────────────────────────────────────────────────

  private stateSubject = new BehaviorSubject<GameState>(emptyState());
  readonly state$: Observable<GameState> = this.stateSubject.asObservable();

  private playersSubject = new BehaviorSubject<Player[]>([]);
  readonly players$: Observable<Player[]> = this.playersSubject.asObservable();

  private lastSetBySource = new Subject<PlayerId>();
  /**
   * Emits a PlayerId when a set is found, then null after LAST_SET_BANNER_MS.
   */
  readonly lastSetBy$: Observable<PlayerId | null> = merge(
    this.lastSetBySource.pipe(map((id): PlayerId | null => id)),
    this.lastSetBySource.pipe(delay(LAST_SET_BANNER_MS), map((): PlayerId | null => null)),
  );

  /**
   * Emits the PlayerId of whoever currently holds the call-SET lock (from
   * the server's room_state), or null when nobody has called.
   */
  private callerLockIdSubject = new BehaviorSubject<PlayerId | null>(null);
  readonly callerLockId$: Observable<PlayerId | null> = this.callerLockIdSubject.asObservable();

  private eventsSubject = new Subject<GameEvent>();
  readonly events$: Observable<GameEvent> = this.eventsSubject.asObservable();

  // ── Room identity ─────────────────────────────────────────────────────────

  private playerId: PlayerId = '';
  private roomIdValue: string = '';
  /** Tracks the previous lastSetBy to avoid re-firing the banner on every room_state. */
  private prevLastSetBy: PlayerId | null = null;
  get roomId(): string { return this.roomIdValue; }

  private roomIdSubject = new BehaviorSubject<string>('');
  readonly roomId$: Observable<string> = this.roomIdSubject.pipe(distinctUntilChanged());

  private roomStatusSubject = new BehaviorSubject<string>('connecting');
  readonly roomStatus$: Observable<string> = this.roomStatusSubject.asObservable();

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private ws: WebSocket | null = null;
  /** Number of automatic reconnection attempts made in a row. */
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    public colorPrefs: ColorPrefsService,
  ) {}

  // ── GameSession interface — colour prefs delegated to ColorPrefsService ──

  get highlightColor(): string                        { return this.colorPrefs.highlightColor; }
  getPalette(): string[]                              { return this.colorPrefs.getPalette(); }
  getPaletteColor(index: number): string              { return this.colorPrefs.getPaletteColor(index); }
  updatePaletteColor(index: number, color: string)    { this.colorPrefs.updatePaletteColor(index, color); }
  updateHighlightColor(color: string)                 { this.colorPrefs.updateHighlightColor(color); }
  getCardColor(cardId: string): string | undefined    { return this.colorPrefs.getCardColor(cardId); }

  // ── Connection ────────────────────────────────────────────────────────────

  /**
   * Open the WebSocket and join (or reconnect to) a room.
   * @param roomId      The room ID from the URL, or 'new' to create a fresh room.
   * @param playerName  Display name chosen by the local player.
   * @param maxPlayers  Only used when creating a new room. Default 2.
   */
  connect(roomId: string, playerName: string, maxPlayers = 2): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;

    this.ws = new WebSocket(url);

    // Detect up-front whether we'll attempt a reconnect so the UI can
    // show "Rejoining…" instead of "Setting up your room".
    const savedRoomId   = localStorage.getItem(SS_ROOM_ID);
    const savedPlayerId = localStorage.getItem(SS_PLAYER_ID);
    const isReconnect   = !!(savedRoomId && savedPlayerId && roomId === savedRoomId);

    this.ws.onopen = () => {
      this.roomStatusSubject.next(isReconnect ? 'reconnecting' : 'connecting');

      if (isReconnect) {
        this.ws!.send(JSON.stringify({
          type: 'reconnect',
          roomId: savedRoomId,
          playerId: savedPlayerId,
        }));
      } else {
        this.ws!.send(JSON.stringify({
          type: 'join',
          roomId,
          playerName,
          maxPlayers,
        }));
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        this.handleServerMessage(msg, { roomId, playerName, maxPlayers });
      } catch {
        console.error('[MultiplayerGameSession] Failed to parse server message', event.data);
      }
    };

    this.ws.onclose = () => {
      const status = this.roomStatusSubject.getValue();
      // If we were still in the middle of (re)connecting and haven't
      // exhausted retries, automatically try again with exponential backoff.
      if (
        (status === 'connecting' || status === 'reconnecting') &&
        this.reconnectAttempts < MultiplayerGameSession.MAX_RECONNECT_ATTEMPTS
      ) {
        this.reconnectAttempts++;
        const delayMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 8000);
        setTimeout(() => this.connect(roomId, playerName, maxPlayers), delayMs);
        return;
      }
      this.roomStatusSubject.next('disconnected');
    };

    this.ws.onerror = (err) => {
      console.error('[MultiplayerGameSession] WebSocket error', err);
      // Don't immediately set 'error' — let onclose handle retry logic.
      // Only set 'error' if we're past the connecting phase.
      const status = this.roomStatusSubject.getValue();
      if (status !== 'connecting' && status !== 'reconnecting') {
        this.roomStatusSubject.next('error');
      }
    };
  }

  /**
   * Graceful leave: tells the server to permanently remove this player, then
   * closes the socket and clears stored credentials.
   */
  leave(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'leave' }));
    }
    this.clearStoredSession();
    // Prevent the onclose handler from auto-retrying.
    this.reconnectAttempts = MultiplayerGameSession.MAX_RECONNECT_ATTEMPTS;
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Silent disconnect (e.g. navigation away, browser close).
   * Credentials are kept so the player can reconnect within the grace period.
   */
  disconnect(): void {
    // Set a terminal status so the onclose handler doesn't auto-retry.
    this.reconnectAttempts = MultiplayerGameSession.MAX_RECONNECT_ATTEMPTS;
    this.ws?.close();
    this.ws = null;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  // ── Server message handler ────────────────────────────────────────────────

  private handleServerMessage(
    msg: ServerMessage,
    connectArgs: { roomId: string; playerName: string; maxPlayers: number },
  ): void {
    if (msg.type === 'joined') {
      this.playerId = msg.playerId;
      this.roomIdValue = msg.roomId;
      this.roomIdSubject.next(msg.roomId);
      // Connection succeeded — reset the retry counter.
      this.reconnectAttempts = 0;
      // Persist for reconnection.
      localStorage.setItem(SS_PLAYER_ID, msg.playerId);
      localStorage.setItem(SS_ROOM_ID, msg.roomId);
      return;
    }

    switch (msg.type) {
      case 'room_state': {
        // Convert the server's RoomState to the GameState the component expects.
        // roomStateToGameState injects myPlayerId and players so the template
        // can identify which player is local and show names.
        this.stateSubject.next(roomStateToGameState(msg.state, this.playerId));
        // Also update the caller-lock subject so the Call SET button disables correctly.
        this.callerLockIdSubject.next(msg.state.callerLockId);
        // Update the room status so the overlay transitions correctly.
        this.roomStatusSubject.next(msg.state.status);
        // Trigger the lastSetBy banner only when it changes to a NEW non-null value.
        // Without this guard, every room_state broadcast (e.g. when someone calls SET)
        // would re-fire the banner for the previous set finder.
        const newLastSetBy = msg.state.lastSetBy;
        if (newLastSetBy && newLastSetBy !== this.prevLastSetBy) {
          this.lastSetBySource.next(newLastSetBy);
        }
        this.prevLastSetBy = newLastSetBy;
        this.playersSubject.next(msg.state.players);
        break;
      }
      case 'game_event': {
        this.eventsSubject.next(msg.event);
        return;
      }

      case 'error': {
        console.error('[MultiplayerGameSession] Server error:', msg.message);
        // If the reconnect was rejected (room expired / player evicted), fall
        // back to a fresh room creation so the player isn't stuck on a blank
        // screen.  Always use 'new' — the original room no longer exists, so
        // retrying with the old roomId would just produce another error.
        if (msg.message.includes('not found') || msg.message.includes('Player not found')) {
          this.clearStoredSession();
          this.ws?.send(JSON.stringify({
            type: 'join',
            roomId: 'new',
            playerName: connectArgs.playerName,
            maxPlayers: connectArgs.maxPlayers,
          }));
          return;
        }
        // Any other server error while still on the connecting/reconnecting
        // overlay should transition to 'error' so the user isn't stuck.
        const currentStatus = this.roomStatusSubject.getValue();
        if (currentStatus === 'connecting' || currentStatus === 'reconnecting') {
          this.roomStatusSubject.next('error');
        }
        break;
      }
    }
  }

  private clearStoredSession(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(SS_PLAYER_ID);
    localStorage.removeItem(SS_ROOM_ID);
  }

  // ── GameSession actions ───────────────────────────────────────────────────

  selectCard(card: Card): void {
    this.ws?.send(JSON.stringify({ type: 'select_card', cardId: card.id }));
  }

  callSet(): void {
    this.ws?.send(JSON.stringify({ type: 'call_set' }));
  }

  /**
   * Multiplayer: no-op — the server applies the timeout penalty and clears
   * the selection in the next room_state broadcast.
   */
  clearSelectionOnCancel(): void { /* server handles this */ }

  startNewGame(): void {
    this.ws?.send(JSON.stringify({ type: 'new_game' }));
  }

  // ── GameSession queries ───────────────────────────────────────────────────

  getStateSnapshot(): GameState {
    return this.stateSubject.getValue();
  }

  findSetOnBoard(): [number, number, number] | null {
    return findSet(this.stateSubject.getValue().board);
  }
}
