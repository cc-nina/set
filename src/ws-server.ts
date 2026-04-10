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
import { generateDeck, shuffle, isSet, findSet } from './app/game.utils.js';
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
/** Minimum players required to START a game (creator alone can wait). */
const MIN_PLAYERS_TO_START = 2;
/** Hard ceiling — one deck supports up to 8 comfortably. */
const MAX_PLAYERS_LIMIT = 8;
/**
 * How long (ms) a player has to pick 3 cards after calling SET.
 * Must stay in sync with CALL_SET_SECONDS in game-board.component.ts.
 */
const CALL_SET_LOCK_MS = 5_000;
/**
 * How long (ms) a disconnected player's slot is held open for reconnection.
 * After this the player is permanently removed from the room.
 */
const RECONNECT_GRACE_MS = 5 * 60_000; // 5 minutes
/**
 * How long (ms) an empty room (all sockets gone) is kept alive before deletion.
 * Covers the case where the last player's socket drops and they re-open the tab.
 */
const EMPTY_ROOM_TTL_MS = 60_000; // 1 minute

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
  /** Handle for the call-SET expiry timer, if a player has called */
  callLockTimer: ReturnType<typeof setTimeout> | null;
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
  const board = full.slice(0, BOARD_SIZE);
  const deck = full.slice(BOARD_SIZE);
  // Per official rules: if no set exists, deal one extra card at a time until
  // a set is present or the deck runs out.
  while (findSet(board) === null && deck.length > 0) {
    board.push(deck.shift()!);
  }
  return { board, deck };
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
    incorrectSelections: 0,
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
    callerLockId: null,
  };

  const room: Room = {
    state,
    sockets: new Map([[playerId, creatorSocket]]),
    reconnectTimers: new Map(),
    emptyTimer: null,
    callLockTimer: null,
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
    incorrectSelections: 0,
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

  // If this player held the call lock, release it so others can call.
  if (st.callerLockId === playerId) clearCallLock(room);

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

/**
 * Clear the call-SET lock without broadcasting — callers are responsible for
 * broadcasting after this if needed.
 */
function clearCallLock(room: Room): void {
  if (room.callLockTimer !== null) {
    clearTimeout(room.callLockTimer);
    room.callLockTimer = null;
  }
  room.state.callerLockId = null;
}

function applySelection(room: Room, playerId: PlayerId, cardId: string): void {
  const st = room.state;
  const selection = st.selections[playerId];
  if (!selection) return;
  if (st.status !== 'active') return;

  // ── Lock enforcement ────────────────────────────────────────────────────
  // Only the player who called SET may select cards.
  if (st.callerLockId !== playerId) return;

  const card = st.board.find((c) => c.id === cardId);
  if (!card) return;

  const alreadyIdx = selection.findIndex((c) => c.id === cardId);
  if (alreadyIdx >= 0) {
    selection.splice(alreadyIdx, 1);
    return;
  }

  if (selection.length >= 3) {
    // Already have 3 selected — ignore further clicks until the selection is evaluated.
    return;
  }

  selection.push(card);
  if (selection.length < 3) return;

  const [a, b, c] = selection;
  const player = st.players.find((p) => p.id === playerId);
  if (!player) return; // should never happen, but guard against stale state

  if (isSet(a, b, c)) {
    const setIds = new Set([a.id, b.id, c.id]);
    const deck = st.deck.slice();

    // Replace found cards in-place if the deck has cards, otherwise remove them.
    // Cards stay in their positions — no compacting — just like a real game.
    const board: Card[] = [];
    for (const boardCard of st.board) {
      if (setIds.has(boardCard.id)) {
        if (deck.length > 0) {
          board.push(deck.shift()!); // replace in-place
        }
        // else: deck empty — slot is simply dropped (board shrinks by 1)
      } else {
        board.push(boardCard);
      }
    }

    // Per official rules: if no set exists on the remaining board,
    // deal one extra card at a time until a set is present or the deck runs out.
    while (findSet(board) === null && deck.length > 0) {
      board.push(deck.shift()!);
    }

    st.board = board;
    st.deck = deck;
    st.selections[playerId] = [];

    // Remove any cards no longer on the board from other players' selections
    // so they don't hold ghost references that would cause unfair penalties.
    const boardIds = new Set(board.map((bc) => bc.id));
    for (const pid of Object.keys(st.selections)) {
      if (pid !== playerId) {
        st.selections[pid] = st.selections[pid].filter((sc) => boardIds.has(sc.id));
      }
    }

    player.score = player.correctSets + 1 - player.incorrectSelections;
    player.correctSets += 1;
    st.lastSetBy = playerId;

    // Release the call lock — set found successfully.
    clearCallLock(room);

    // If no set exists now, the game is over.
    if (findSet(st.board) === null) {
      st.status = 'finished';
    }
  } else {
    st.selections[playerId] = [];
    player.incorrectSelections += 1;
    player.score = player.correctSets - player.incorrectSelections;
    st.lastSetBy = null;

    // Release the call lock — player was penalised.
    clearCallLock(room);
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

  st.lastSetBy = null;
  // Release any active call lock before the new game starts.
  clearCallLock(room);

  for (const p of st.players) {
    p.score = 0;
    p.correctSets = 0;
    p.incorrectSelections = 0;
    st.selections[p.id] = [];
  }

  // A single connected player can play alone — only fall back to waiting
  // if literally nobody is connected.
  if (st.players.length < 1) {
    st.board = [];
    st.deck = [];
    st.status = 'waiting';
    return;
  }

  const { board, deck } = dealInitial();
  st.board = board;
  st.deck = deck;
  st.status = 'active';
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

  try {
    handleParsedMessage(ws, msg);
  } catch (err) {
    console.error('[ws] Unhandled error in handleMessage', err);
    send(ws, { type: 'error', message: 'Internal server error' });
  }
}

/** Inner handler — separated so the outer function can catch any unexpected throws. */
function handleParsedMessage(ws: GameSocket, msg: ClientMessage): void {
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

    const rawMax = Number(msg.maxPlayers);
    const maxPlayers = Math.min(
      Math.max(Number.isFinite(rawMax) ? Math.floor(rawMax) : MIN_PLAYERS_TO_START, MIN_PLAYERS_TO_START),
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

  // ── call_set ───────────────────────────────────────────────────────────────
  if (msg.type === 'call_set') {
    const st = room.state;
    if (st.status !== 'active') {
      send(ws, { type: 'error', message: 'Cannot call SET when game is not active' });
      return;
    }
    if (st.callerLockId !== null) {
      send(ws, { type: 'error', message: 'Another player already called SET' });
      return;
    }

    const playerId = ws.playerId!;
    st.callerLockId = playerId;
    // Clear any stale selection for the caller before they start picking.
    st.selections[playerId] = [];

    // Arm the server-side expiry timer. When it fires, penalise and unlock.
    room.callLockTimer = setTimeout(() => {
      room.callLockTimer = null;
      if (room.state.callerLockId !== playerId) return; // already resolved
      const player = room.state.players.find((p) => p.id === playerId);
      if (player) {
        room.state.selections[playerId] = [];
        player.incorrectSelections += 1;
        player.score = player.correctSets - player.incorrectSelections;
      }
      room.state.callerLockId = null;
      broadcast(room, { type: 'room_state', state: room.state });
    }, CALL_SET_LOCK_MS);

    broadcast(room, { type: 'room_state', state: room.state });
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
    if (connectedCount(room) < 1) {
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
