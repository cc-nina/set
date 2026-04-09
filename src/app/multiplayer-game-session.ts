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
 *   3. Service opens ws://…/ws, sends { type:'join', … }.
 *   4. Server replies with 'joined' then 'room_state' messages.
 *   5. Every subsequent 'room_state' is mapped to a GameState and emitted on state$.
 *   6. GameBoardComponent subscribes to state$ and renders cards normally.
 *   7. When the user clicks a card, selectCard() sends { type:'select_card' } to the server.
 *   8. GameRoomComponent calls disconnect() on ngOnDestroy.
 */

import { Injectable, Inject, PLATFORM_ID, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  BehaviorSubject,
  Subject,
  Observable,
  of,
  distinctUntilChanged,
  map,
  delay,
  merge,
} from 'rxjs';
import { Card, GameState, Player, PlayerId, RoomState, ServerMessage } from './game.types';
import { findSet } from './game.utils';
import { loadColorPrefs, saveColorPrefs } from './color-prefs.storage';
import { GameSession } from './game-session.interface';

const DEFAULT_PALETTE: [string, string, string] = ['#cc0000', '#0aa64a', '#5a2ea6'];
const DEFAULT_HIGHLIGHT = '#000000';

/** How long (ms) the "Player X found a set!" banner stays visible. */
const LAST_SET_BANNER_MS = 2000;

/** Empty GameState used as a placeholder before the server deals the board. */
function emptyState(): GameState {
  return { deck: [], board: [], selected: [], score: 0, correctSets: 0, incorrectSelections: 0 };
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
    incorrectSelections: 0, // server doesn't track this per-player yet
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
   * GameBoardComponent (and GameRoomComponent) subscribe to show a banner.
   */
  readonly lastSetBy$: Observable<PlayerId | null> = merge(
    this.lastSetBySource.pipe(map((id): PlayerId | null => id)),
    this.lastSetBySource.pipe(delay(LAST_SET_BANNER_MS), map((): PlayerId | null => null)),
  );

  // ── Room identity ─────────────────────────────────────────────────────────

  private playerId: PlayerId = '';
  private roomIdValue: string = '';
  /** The room ID assigned by the server (may differ from the URL when URL is 'new'). */
  get roomId(): string { return this.roomIdValue; }

  /** Emits the assigned room ID once the server confirms the join. */
  private roomIdSubject = new BehaviorSubject<string>('');
  readonly roomId$: Observable<string> = this.roomIdSubject.pipe(
    distinctUntilChanged(),
  );

  /** Current room status — useful for showing a "Waiting for players…" overlay. */
  private roomStatusSubject = new BehaviorSubject<string>('connecting');
  readonly roomStatus$: Observable<string> = this.roomStatusSubject.asObservable();

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private ws: WebSocket | null = null;

  // ── Colour prefs (same logic as SetGameService) ───────────────────────────

  private palette: [string, string, string];
  highlightColor: string;
  private cardColors: Record<string, string> = {};

  constructor(@Inject(PLATFORM_ID) private platformId: object) {
    const saved = isPlatformBrowser(this.platformId) ? loadColorPrefs() : null;
    this.palette = saved
      ? ([...saved.palette] as [string, string, string])
      : ([...DEFAULT_PALETTE] as [string, string, string]);
    this.highlightColor = saved?.highlightColor ?? DEFAULT_HIGHLIGHT;
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /**
   * Open the WebSocket and join (or create) a room.
   * @param roomId  The room ID from the URL, or 'new' to create a fresh room.
   * @param playerName  Display name chosen by the local player.
   * @param maxPlayers  Only used when roomId === 'new'. Default 2.
   */
  connect(roomId: string, playerName: string, maxPlayers = 2): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.roomStatusSubject.next('waiting');
      this.ws!.send(JSON.stringify({
        type: 'join',
        roomId,
        playerName,
        maxPlayers,
      }));
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        this.handleServerMessage(msg);
      } catch {
        console.error('[MultiplayerGameSession] Failed to parse server message', event.data);
      }
    };

    this.ws.onclose = () => {
      this.roomStatusSubject.next('disconnected');
    };

    this.ws.onerror = (err) => {
      console.error('[MultiplayerGameSession] WebSocket error', err);
      this.roomStatusSubject.next('error');
    };
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  // ── Server message handler ────────────────────────────────────────────────

  private handleServerMessage(msg: ServerMessage): void {
    if (msg.type === 'joined') {
      this.playerId = msg.playerId;
      this.roomIdValue = msg.roomId;
      this.roomIdSubject.next(msg.roomId);
      return;
    }

    if (msg.type === 'room_state') {
      const rs = msg.state;
      this.roomStatusSubject.next(rs.status);
      this.playersSubject.next([...rs.players] as Player[]);
      this.stateSubject.next(roomStateToGameState(rs, this.playerId));

      // Only fire the banner when lastSetBy is explicitly set in this message.
      // The server clears it to null on the next card interaction, so a non-null
      // value here means this broadcast IS the "set found" event.
      if (rs.lastSetBy !== null) {
        this.lastSetBySource.next(rs.lastSetBy);
      }
      return;
    }

    if (msg.type === 'error') {
      console.error('[MultiplayerGameSession] Server error:', msg.message);
    }
  }

  // ── GameSession actions ───────────────────────────────────────────────────

  selectCard(card: Card): void {
    this.ws?.send(JSON.stringify({ type: 'select_card', cardId: card.id }));
  }

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

  // ── Colour prefs ──────────────────────────────────────────────────────────

  private savePrefs(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    saveColorPrefs({
      palette: [...this.palette] as [string, string, string],
      highlightColor: this.highlightColor,
    });
  }

  getPalette(): string[] { return this.palette.slice(); }

  getPaletteColor(index: number): string {
    if (!index || index < 1) return this.palette[0];
    return this.palette[(index - 1) % 3] ?? this.palette[0];
  }

  updatePaletteColor(index: number, color: string): void {
    if (!index || index < 1 || index > 3) return;
    const normalized = color.toLowerCase();
    const pos = index - 1;
    if (this.palette[pos] === normalized) return;
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

  updateHighlightColor(color: string): void {
    this.highlightColor = color.toLowerCase();
    this.savePrefs();
  }

  getCardColor(cardId: string): string | undefined {
    return this.cardColors[cardId];
  }
}
