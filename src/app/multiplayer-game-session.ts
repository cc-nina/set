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
import { Card, GameState, MultiplayerGameState, Player, PlayerId, RoomState, ServerMessage, LAST_SET_BANNER_MS, GameEvent } from './game.types';
import { findSet } from './game.utils';
import { GameSession } from './game-session.interface';
import { ColorPrefsService } from './color-prefs.service';
import { loadMultiplayerState, saveMultiplayerState, clearMultiplayerState } from './game-state.storage';

// localStorage keys for reconnection (localStorage persists across tab closes,
// unlike sessionStorage which is cleared when the tab is closed — essential for
// the "close tab → reopen link" reconnection flow).
const SS_PLAYER_ID = 'mp_playerId';
const SS_ROOM_ID   = 'mp_roomId';

/** Empty MultiplayerGameState used as a placeholder before the server deals the board. */
function emptyState(): MultiplayerGameState {
  return { deck: [], board: [], selected: [], score: 0, correctSets: 0, incorrectSelections: 0, status: 'active', myPlayerId: '', players: [] };
}

/**
 * Map a server RoomState to the MultiplayerGameState shape that GameBoardComponent expects.
 * The local player's selection becomes `selected`; score comes from the local player entry.
 */
function roomStateToGameState(rs: RoomState, playerId: PlayerId): MultiplayerGameState {
  const me = rs.players.find((p) => p.id === playerId);
  return {
    deck: rs.deck,
    board: rs.board,
    selected: rs.selections[playerId] ?? [],
    score: me?.score ?? 0,
    correctSets: me?.correctSets ?? 0,
    incorrectSelections: me?.incorrectSelections ?? 0,
    status: rs.status === 'finished' ? 'finished' : 'active',
    lastNegCardIds: rs.lastNegCardIds,
    myPlayerId: playerId,
    players: rs.players,
  };
}

@Injectable()
export class MultiplayerGameSession implements GameSession, OnDestroy {
  // ── Public streams ────────────────────────────────────────────────────────

  readonly isMultiplayer = true;
  readonly requiresCallSet = true;

  private stateSubject = new BehaviorSubject<MultiplayerGameState>(emptyState());
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

  private negSetBySource = new Subject<PlayerId>();
  /**
   * Emits a PlayerId when a neg happens, then null after the animation window.
   */
  readonly negSetBy$: Observable<PlayerId | null> = merge(
    this.negSetBySource.pipe(map((id): PlayerId | null => id)),
    this.negSetBySource.pipe(delay(LAST_SET_BANNER_MS), map((): PlayerId | null => null)),
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
  /** Tracks each player's previous score to detect correct sets from room_state. */
  private prevScoreMap = new Map<PlayerId, number>();
  /** Tracks each player's previous incorrectSelections to detect negs from room_state. */
  private prevIncorrectSelectionsMap = new Map<PlayerId, number>();
  /** Tracks each player's previous connected state to detect disconnects from room_state. */
  private prevConnectedMap = new Map<PlayerId, boolean>();
  get roomId(): string { return this.roomIdValue; }

  private roomIdSubject = new BehaviorSubject<string>('');
  readonly roomId$: Observable<string> = this.roomIdSubject.pipe(distinctUntilChanged());

  private roomStatusSubject = new BehaviorSubject<string>('connecting');
  readonly roomStatus$: Observable<string> = this.roomStatusSubject.asObservable();

  private isReconnectAttempt = false;

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private ws: WebSocket | null = null;
  /** Number of automatic reconnection attempts made in a row. */
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private lastConnectArgs: { roomId: string; playerName: string; maxPlayers: number } | null = null;

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
  updateCardColor(color: string, cardId?: string): void {
    const boardCardIds = cardId ? undefined : this.stateSubject.getValue().board.map(c => c.id);
    this.colorPrefs.updateCardColor(color, cardId, boardCardIds);
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /** Manually retry after a disconnect — resets the attempt counter and reconnects. */
  retry(): void {
    if (!this.lastConnectArgs) return;
    this.reconnectAttempts = 0;
    this.roomStatusSubject.next('connecting');
    // Prefer the server-assigned room ID (roomIdValue) over the original connect arg,
    // which may be 'new' for rooms that were created and assigned a real ID mid-session.
    const roomId = this.roomIdValue || this.lastConnectArgs.roomId;
    this.connect(roomId, this.lastConnectArgs.playerName, this.lastConnectArgs.maxPlayers);
  }

  connect(roomId: string, playerName: string, maxPlayers = 2): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.lastConnectArgs = { roomId, playerName, maxPlayers };

    // Detach handlers from any previous socket before creating a new one.
    // Without this, a stale onclose can fire after the new socket is assigned
    // and spawn a second concurrent reconnect loop on flaky networks.
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
    }

    const url = `wss://34.44.229.168.sslip.io:3000`;

    this.ws = new WebSocket(url);

    // Detect up-front whether we'll attempt a reconnect so the UI can
    // show "Rejoining…" instead of "Setting up your room".
    const savedRoomId   = localStorage.getItem(SS_ROOM_ID);
    const savedPlayerId = localStorage.getItem(SS_PLAYER_ID);
    const isReconnect   = !!(savedRoomId && savedPlayerId && roomId === savedRoomId);
    this.isReconnectAttempt = isReconnect;

    if (roomId !== 'new') {
      const saved = loadMultiplayerState(roomId);
      if (saved) this.stateSubject.next({ ...saved, myPlayerId: '', players: [] });
    }

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
        const gs = roomStateToGameState(msg.state, this.playerId);
        this.stateSubject.next(gs);
        saveMultiplayerState(this.roomIdValue, gs);
        // Also update the caller-lock subject so the Call SET button disables correctly.
        this.callerLockIdSubject.next(msg.state.callerLockId);
        // Update the room status so the overlay transitions correctly.
        this.roomStatusSubject.next(msg.state.status);
        // Trigger the lastSetBy banner whenever a player's score increases.
        for (const player of msg.state.players) {
          const prev = this.prevScoreMap.get(player.id) ?? 0;
          if (player.score > prev) {
            this.lastSetBySource.next(player.id);
          }
          this.prevScoreMap.set(player.id, player.score);
        }
        // Trigger the neg animation for whichever player's incorrectSelections increased.
        // Iterating all players (not just local) ensures every client sees the shake
        // regardless of who made the incorrect selection.
        for (const player of msg.state.players) {
          const prev = this.prevIncorrectSelectionsMap.get(player.id) ?? 0;
          if (player.incorrectSelections > prev) {
            this.negSetBySource.next(player.id);
          }
          this.prevIncorrectSelectionsMap.set(player.id, player.incorrectSelections);

          const wasConnected = this.prevConnectedMap.get(player.id);
          if (wasConnected === true && !player.connected) {
            this.eventsSubject.next({ id: `dc-${player.id}-${Date.now()}`, type: 'disconnect', playerId: player.id, playerName: player.name, playerColorIndex: player.colorIndex, timestamp: Date.now() });
          }
          this.prevConnectedMap.set(player.id, player.connected);
        }
        this.playersSubject.next(msg.state.players);
        break;
      }
      case 'game_event': {
        this.eventsSubject.next(msg.event);
        return;
      }

      case 'error': {
        console.error('[MultiplayerGameSession] Server error:', msg.message);
        // Reconnect rejected (room expired / player evicted) → fall back to a
        // fresh room so the player isn't stuck on a blank screen.
        // User-entered invalid room code → show an error overlay instead of
        // silently creating a new room they didn't ask for.
        if (msg.message.includes('not found') || msg.message.includes('Player not found')) {
          if (this.isReconnectAttempt) {
            this.clearStoredSession();
            this.ws?.send(JSON.stringify({
              type: 'join',
              roomId: 'new',
              playerName: connectArgs.playerName,
              maxPlayers: connectArgs.maxPlayers,
            }));
          } else {
            this.roomStatusSubject.next('room_not_found');
            this.reconnectAttempts = MultiplayerGameSession.MAX_RECONNECT_ATTEMPTS;
          }
          return;
        }
        // Room is full or no longer accepting players — show a specific overlay
        // instead of the generic "Disconnected" screen.
        if (msg.message.includes('full') || msg.message.includes('not accepting')) {
          this.roomStatusSubject.next('room_full');
          // Stop auto-retry so we don't hammer a full room.
          this.reconnectAttempts = MultiplayerGameSession.MAX_RECONNECT_ATTEMPTS;
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
    clearMultiplayerState();
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
