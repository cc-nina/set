export type Attr = 1 | 2 | 3;

export interface Card {
  id: string;
  number: Attr;
  color: Attr;
  shape: Attr;
  shading: Attr;
}

// ── Single-player state ────────────────────────────────────────────────────────

export interface GameState {
  deck: Card[]; // remaining deck (top is index 0)
  board: Card[]; // visible cards on the table
  selected: Card[]; // currently selected cards (max 3)
  score: number;
  correctSets: number; // number of correctly found sets
  incorrectSelections: number; // number of incorrect selection attempts
}

// ── Multiplayer types ──────────────────────────────────────────────────────────

/** Opaque player identifier — a nanoid assigned by the server on join. */
export type PlayerId = string;

export interface Player {
  id: PlayerId;
  name: string;
  score: number;
  correctSets: number;
  /** False while the player's WebSocket is closed but within the reconnect window. */
  connected: boolean;
}

export type RoomStatus =
  | 'waiting'   // room created, not yet enough players to start
  | 'active'    // enough players connected, game in progress
  | 'finished'; // deck exhausted or too many players disconnected

export interface RoomState {
  roomId: string;
  status: RoomStatus;
  /**
   * All players in the room. Index 0 is always the room creator.
   * Length ranges from 1 (waiting) up to maxPlayers (active/finished).
   */
  players: Player[];
  /** Maximum number of players allowed in this room (set by the creator, default 2). */
  maxPlayers: number;
  board: Card[];
  deck: Card[];
  /**
   * Each player maintains an independent selection of up to 3 cards.
   * When a player's selection reaches 3 the server evaluates it immediately.
   */
  selections: Record<PlayerId, Card[]>;
  /**
   * The id of the player who most recently completed a valid set, or null if
   * no set has been found yet in this game. Used to briefly highlight the
   * finder's name in both players' UIs.
   */
  lastSetBy: PlayerId | null;
}

// ── WebSocket message protocol ─────────────────────────────────────────────────

/** Messages sent from a browser client to the server. */
export type ClientMessage =
  | { type: 'join';        roomId: string; playerName: string; maxPlayers?: number }
  | { type: 'reconnect';   roomId: string; playerId: PlayerId }
  | { type: 'select_card'; cardId: string }
  | { type: 'new_game' }
  | { type: 'leave' };

/** Messages sent from the server to a browser client. */
export type ServerMessage =
  | { type: 'joined';     playerId: PlayerId; roomId: string }
  | { type: 'room_state'; state: RoomState }
  | { type: 'error';      message: string };
