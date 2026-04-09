/**
 * ws-server.ts
 *
 * Self-contained WebSocket game-room server.
 * Attach to an existing Node http.Server via `attachWebSocketServer(httpServer)`.
 *
 * Protocol (shared with the client via game.types.ts):
 *   Client → Server  ClientMessage  { join | reconnect | select_card | new_game | leave }
 *   Server → Client  ServerMessage  { joined | room_state | error }
 *
 * Room lifecycle:
 *   1. Player A sends  { type:'join', roomId:'new', playerName:'Alice', maxPlayers:4 }
 *      → server mints a roomId, assigns playerId, replies { type:'joined', ... }
 *      → broadcasts room_state (status:'waiting', 1 player)
 *   2–N. Players B…N send  { type:'join', roomId:'abc123', playerName:'...' }
 *      → each gets { type:'joined', ... } + a room_state broadcast
 *      → when the Nth player joins, status becomes 'active' and the deck is dealt
 *   N+1. Any player sends { type:'select_card', cardId }
 *      → server appends card to that player's selection
 *      → if selection reaches 3: evaluate, apply or penalise, broadcast
 *   *. Any player sends { type:'new_game' }
 *      → server resets room (allowed when status is 'active' or 'finished')
 *   *. Player disconnects (unclean) or sends { type:'leave' } (clean)
 *      → marked connected:false; selection cleared; room continues if ≥1 player online
 *      → player may reconnect within RECONNECT_GRACE_MS by sending { type:'reconnect', ... }
 *      → if last socket closes, room is deleted after EMPTY_ROOM_TTL_MS
 */

import WebSocket, { WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { generateDeck, shuffle, isSet } from './app/game.utils.js';
import type {
  Card,
  Player,
  PlayerId,
  RoomState,
  ClientMessage,
  ServerMessage,
} from './app/game.types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const BOARD_SIZE = 12;
const SCORE_CORRECT = 3;
const SCORE_INCORRECT = -1;
/** Minimum players required to START a game (creator alone can wait). */
const MIN_PLAYERS_TO_START = 2;
/** Hard ceiling — one deck supports up to 8 comfortably. */
const MAX_PLAYERS_LIMIT = 8;
/**
 * How long (ms) a disconnected player's slot is held open for reconnection.
 * After this the player is permanently removed from the room.
 */
const RECONNECT_GRACE_MS = 60_000; // 1 minute
/**
 * How long (ms) an empty room (all sockets gone) is kept alive before deletion.
 * Covers the case where the last player's socket drops and they re-open the tab.
 */
const EMPTY_ROOM_TTL_MS = 30_000; // 30 seconds

// ── In-memory store ──────────────────────────────────────────────────────────

/** Live WebSocket connection annotated with game identity. */
type GameSocket = WebSocket & {
  playerId?: PlayerId;
  roomId?: string;
  /** Set to true when the player voluntarily left — prevents handleClose from
   *  arming a reconnect timer for an already-evicted player. */
  intentionalClose?: boolean;
};

/** Everything the server needs to know about a room. */
interface Room {
  state: RoomState;
  /** playerId → live socket (only present while connected) */
  sockets: Map<PlayerId, GameSocket>;
  /** playerId → handle returned by setTimeout for the reconnect deadline */
  reconnectTimers: Map<PlayerId, ReturnType<typeof setTimeout>>;
  /** Handle for the empty-room deletion timer, if armed */
  emptyTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomId(byteLength = 4): string {
  return randomBytes(byteLength).toString('hex');
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Broadcast to all currently-connected sockets in the room. */
function broadcast(room: Room, msg: ServerMessage): void {
  const json = JSON.stringify(msg);
  for (const ws of room.sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

function dealInitial(): { board: Card[]; deck: Card[] } {
  const full = shuffle(generateDeck());
  return { board: full.slice(0, BOARD_SIZE), deck: full.slice(BOARD_SIZE) };
}

function refillBoard(board: Card[], deck: Card[]): void {
  while (board.length < BOARD_SIZE && deck.length > 0) {
    board.push(deck.shift()!);
  }
}

/** Count players whose connected flag is true. */
function connectedCount(room: Room): number {
  return room.state.players.filter((p) => p.connected).length;
}

// ── Room actions ─────────────────────────────────────────────────────────────

function createRoom(creatorSocket: GameSocket, playerName: string, maxPlayers: number): Room {
  const roomId = randomId(3);   // 3 bytes → 6 hex chars
  const playerId = randomId(8); // 8 bytes → 16 hex chars

  creatorSocket.playerId = playerId;
  creatorSocket.roomId = roomId;

  const player: Player = {
    id: playerId,
    name: playerName,
    score: 0,
    correctSets: 0,
    connected: true,
  };

  const state: RoomState = {
    roomId,
    status: 'waiting',
    players: [player],
    maxPlayers,
    board: [],
    deck: [],
    selections: { [playerId]: [] },
    lastSetBy: null,
  };

  const room: Room = {
    state,
    sockets: new Map([[playerId, creatorSocket]]),
    reconnectTimers: new Map(),
    emptyTimer: null,
  };
  rooms.set(roomId, room);
  return room;
}

function joinRoom(room: Room, joinerSocket: GameSocket, playerName: string): void {
  const playerId = randomId(8);
  joinerSocket.playerId = playerId;
  joinerSocket.roomId = room.state.roomId;

  const newPlayer: Player = {
    id: playerId,
    name: playerName,
    score: 0,
    correctSets: 0,
    connected: true,
  };
  const st = room.state;

  st.players = [...st.players, newPlayer];
  st.selections[playerId] = [];
  room.sockets.set(playerId, joinerSocket);

  // Start once the room reaches maxPlayers.
  if (st.players.length >= st.maxPlayers) {
    st.status = 'active';
    const { board, deck } = dealInitial();
    st.board = board;
    st.deck = deck;
  }
}

/**
 * Permanently remove a player from the room (called after the reconnect grace
 * period expires, or when the player explicitly sends { type:'leave' }).
 * If the room is then empty of all players it is deleted immediately.
 */
function evictPlayer(room: Room, playerId: PlayerId): void {
  const st = room.state;

  // Cancel any pending reconnect timer (safe to call even if already cancelled).
  const timer = room.reconnectTimers.get(playerId);
  if (timer !== undefined) {
    clearTimeout(timer);
    room.reconnectTimers.delete(playerId);
  }

  // Socket may already be gone (unclean disconnect path) — delete is a no-op if absent.
  room.sockets.delete(playerId);
  st.players = st.players.filter((p) => p.id !== playerId);
  delete st.selections[playerId];

  if (st.lastSetBy === playerId) st.lastSetBy = null;

  // Room is now empty — schedule deletion.
  if (st.players.length === 0) {
    scheduleEmptyRoomDeletion(room);
    return;
  }

  // If the game was active and every remaining player is offline, finish it.
  if (st.status === 'active' && connectedCount(room) === 0) {
    st.status = 'finished';
  }
}

function scheduleEmptyRoomDeletion(room: Room): void {
  if (room.emptyTimer !== null) return; // already scheduled
  room.emptyTimer = setTimeout(() => {
    rooms.delete(room.state.roomId);
  }, EMPTY_ROOM_TTL_MS);
}

function cancelEmptyRoomDeletion(room: Room): void {
  if (room.emptyTimer !== null) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
  }
}

function applySelection(room: Room, playerId: PlayerId, cardId: string): void {
  const st = room.state;
  const selection = st.selections[playerId];
  if (!selection) return;
  if (st.status !== 'active') return;

  const card = st.board.find((c) => c.id === cardId);
  if (!card) return;

  st.lastSetBy = null;

  const alreadyIdx = selection.findIndex((c) => c.id === cardId);
  if (alreadyIdx >= 0) {
    selection.splice(alreadyIdx, 1);
    return;
  }

  if (selection.length >= 3) {
    st.selections[playerId] = [card];
    return;
  }

  selection.push(card);
  if (selection.length < 3) return;

  const [a, b, c] = selection;
  const player = st.players.find((p) => p.id === playerId)!;

  if (isSet(a, b, c)) {
    const setIds = new Set([a.id, b.id, c.id]);
    const deck = st.deck.slice();
    const board = st.board
      .map((boardCard) => {
        if (setIds.has(boardCard.id) && deck.length > 0) return deck.shift()!;
        return setIds.has(boardCard.id) ? null : boardCard;
      })
      .filter((bc): bc is Card => bc !== null);

    refillBoard(board, deck);

    st.board = board;
    st.deck = deck;
    st.selections[playerId] = [];
    player.score = Math.max(0, player.score + SCORE_CORRECT);
    player.correctSets += 1;
    st.lastSetBy = playerId;

    if (st.board.length === 0 && st.deck.length === 0) {
      st.status = 'finished';
    }
  } else {
    st.selections[playerId] = [];
    player.score = Math.max(0, player.score + SCORE_INCORRECT);
  }
}

function resetRoom(room: Room): void {
  const st = room.state;

  // Cancel reconnect timers for any disconnected players — they are being
  // dropped from the room as part of the reset and must not be evicted again.
  for (const p of st.players) {
    if (!p.connected) {
      const timer = room.reconnectTimers.get(p.id);
      if (timer !== undefined) {
        clearTimeout(timer);
        room.reconnectTimers.delete(p.id);
      }
      delete st.selections[p.id];
    }
  }

  st.players = st.players.filter((p) => p.connected);

  const { board, deck } = dealInitial();
  st.board = board;
  st.deck = deck;
  st.status = 'active';
  st.lastSetBy = null;

  for (const p of st.players) {
    p.score = 0;
    p.correctSets = 0;
    st.selections[p.id] = [];
  }
}

// ── Message handler ──────────────────────────────────────────────────────────

function handleMessage(ws: GameSocket, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    send(ws, { type: 'error', message: 'Invalid JSON' });
    return;
  }

  // ── reconnect ──────────────────────────────────────────────────────────────
  if (msg.type === 'reconnect') {
    if (!msg.roomId || !msg.playerId) {
      send(ws, { type: 'error', message: 'reconnect requires roomId and playerId' });
      return;
    }
    const room = rooms.get(msg.roomId);
    if (!room) {
      send(ws, { type: 'error', message: `Room ${msg.roomId} not found or expired` });
      return;
    }
    const player = room.state.players.find((p) => p.id === msg.playerId);
    if (!player) {
      send(ws, { type: 'error', message: 'Player not found in room — join as a new player' });
      return;
    }

    // Cancel the pending eviction timer.
    const timer = room.reconnectTimers.get(msg.playerId);
    if (timer !== undefined) {
      clearTimeout(timer);
      room.reconnectTimers.delete(msg.playerId);
    }
    cancelEmptyRoomDeletion(room);

    // Attach the new socket.
    ws.playerId = msg.playerId;
    ws.roomId = msg.roomId;
    player.connected = true;
    room.sockets.set(msg.playerId, ws);

    send(ws, { type: 'joined', playerId: msg.playerId, roomId: msg.roomId });
    broadcast(room, { type: 'room_state', state: room.state });
    return;
  }

  // ── join ───────────────────────────────────────────────────────────────────
  if (msg.type === 'join') {
    const { roomId, playerName } = msg;

    if (!roomId) {
      send(ws, { type: 'error', message: 'join requires roomId' });
      return;
    }

    const maxPlayers = Math.min(
      Math.max(Math.floor(msg.maxPlayers ?? MIN_PLAYERS_TO_START), MIN_PLAYERS_TO_START),
      MAX_PLAYERS_LIMIT,
    );

    if (!playerName?.trim()) {
      send(ws, { type: 'error', message: 'playerName is required' });
      return;
    }

    if (roomId === 'new') {
      const room = createRoom(ws, playerName.trim(), maxPlayers);
      const pid = ws.playerId!;
      send(ws, { type: 'joined', playerId: pid, roomId: room.state.roomId });
      broadcast(room, { type: 'room_state', state: room.state });
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      send(ws, { type: 'error', message: `Room ${roomId} not found` });
      return;
    }
    if (room.state.status !== 'waiting') {
      send(ws, { type: 'error', message: 'Room is not accepting new players' });
      return;
    }
    if (room.state.players.length >= room.state.maxPlayers) {
      send(ws, { type: 'error', message: 'Room is full' });
      return;
    }

    joinRoom(room, ws, playerName.trim());
    const pid = ws.playerId!;
    send(ws, { type: 'joined', playerId: pid, roomId });
    broadcast(room, { type: 'room_state', state: room.state });
    return;
  }

  // All other messages require the socket to already be in a room.
  const room = ws.roomId ? rooms.get(ws.roomId) : undefined;
  if (!room || !ws.playerId) {
    send(ws, { type: 'error', message: 'Not in a room — send { type:"join" } first' });
    return;
  }

  // ── leave ──────────────────────────────────────────────────────────────────
  if (msg.type === 'leave') {
    ws.intentionalClose = true; // prevent handleClose from re-processing this socket
    evictPlayer(room, ws.playerId);
    ws.close();
    if (room.state.players.length > 0) {
      broadcast(room, { type: 'room_state', state: room.state });
    }
    return;
  }

  // ── select_card ────────────────────────────────────────────────────────────
  if (msg.type === 'select_card') {
    if (!msg.cardId) {
      send(ws, { type: 'error', message: 'select_card requires cardId' });
      return;
    }
    applySelection(room, ws.playerId, msg.cardId);
    broadcast(room, { type: 'room_state', state: room.state });
    return;
  }

  // ── new_game ───────────────────────────────────────────────────────────────
  if (msg.type === 'new_game') {
    const activeCount = connectedCount(room);
    if (activeCount < 1) {
      send(ws, { type: 'error', message: 'No connected players to start a new game' });
      return;
    }
    resetRoom(room);
    broadcast(room, { type: 'room_state', state: room.state });
    return;
  }
}

// ── Disconnect handling ──────────────────────────────────────────────────────

function handleClose(ws: GameSocket): void {
  if (!ws.roomId || !ws.playerId) return;
  // If the socket was closed as part of a deliberate leave(), evictPlayer()
  // has already run — do nothing (no reconnect timer, no ghost broadcast).
  if (ws.intentionalClose) return;

  const room = rooms.get(ws.roomId);
  if (!room) return;

  const { playerId } = ws;
  const player = room.state.players.find((p) => p.id === playerId);

  // Mark offline so the UI can show the player as disconnected.
  if (player) player.connected = false;

  // Remove socket reference — the player slot stays.
  room.sockets.delete(playerId);

  // Cancel any existing timer for this player before arming a new one.
  // (Guards against edge cases where a socket emits close more than once.)
  const existingTimer = room.reconnectTimers.get(playerId);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
    room.reconnectTimers.delete(playerId);
  }

  // Arm a per-player reconnect grace timer regardless of whether other
  // players are still online.  After it fires the player is permanently
  // evicted (and if the room is then empty, it is deleted).
  const timer = setTimeout(() => {
    room.reconnectTimers.delete(playerId);
    evictPlayer(room, playerId);
    if (room.state.players.length > 0) {
      broadcast(room, { type: 'room_state', state: room.state });
    }
  }, RECONNECT_GRACE_MS);
  room.reconnectTimers.set(playerId, timer);

  if (room.sockets.size === 0) {
    // No live sockets — also arm the empty-room short-circuit TTL so the
    // room is cleaned up quickly if no one reconnects at all.
    scheduleEmptyRoomDeletion(room);
    return; // nothing to broadcast to
  }

  // Tell remaining players immediately so the UI can show "Player X disconnected".
  broadcast(room, { type: 'room_state', state: room.state });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Attach a WebSocket server to an existing http.Server.
 * The upgrade path is `/ws` so normal HTTP traffic is unaffected.
 */
export function attachWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: GameSocket) => {
    ws.on('message', (data) => handleMessage(ws, data.toString()));
    ws.on('close', () => handleClose(ws));
    ws.on('error', (err) => console.error('[ws] socket error', err));
  });

  console.log('[ws] WebSocket server attached on path /ws');
}
