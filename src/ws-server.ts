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
 *   1. Player A sends  { type:'join', roomId:'new', playerName:'FunnyFish', maxPlayers:4 }
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
import { createServer, type Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isSet, findSet, dealInitialBoard } from './app/game.utils.js';
import type {
  Card,
  Player,
  PlayerId,
  RoomState,
  ClientMessage,
  ServerMessage,
  GameEvent,
} from './app/game.types.js';
import { CALL_SET_SECONDS } from './app/game.types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const BOARD_SIZE = 12;
/** Minimum players required to START a game (creator alone can wait). */
const MIN_PLAYERS_TO_START = 2;
/** Hard ceiling — one deck supports up to 8 comfortably. */
const MAX_PLAYERS_LIMIT = 8;
/**
 * How long (ms) a player has to pick 3 cards after calling SET.
 * Derived from the shared CALL_SET_SECONDS constant in game.types.ts.
 */
const CALL_SET_LOCK_MS = CALL_SET_SECONDS * 1000;
/**
 * How long (ms) a disconnected player's slot is held open for reconnection.
 * After this the player is permanently removed from the room.
 */
const RECONNECT_GRACE_MS = 5 * 60_000; // 5 minutes
/**
 * How long (ms) an empty room (all sockets gone) is kept alive before deletion.
 * Must be at least as long as RECONNECT_GRACE_MS so a solo player who closes
 * the tab can still rejoin within the full reconnect window.
 */
const EMPTY_ROOM_TTL_MS = RECONNECT_GRACE_MS;

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

/** Broadcast a game event to all players in the room. */
function broadcastEvent(room: Room, type: GameEvent['type'], player: Player): void {
  const event: GameEvent = {
    id: randomId(4),
    type,
    playerId: player.id,
    playerName: player.name,
    timestamp: Date.now(),
  };
  broadcast(room, { type: 'game_event', event });
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
    const { board, deck } = dealInitialBoard();
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
    let hasSet = findSet(board) !== null;
    while (!hasSet && deck.length > 0) {
      board.push(deck.shift()!);
      hasSet = findSet(board) !== null;
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

    player.correctSets += 1;
    player.score = player.correctSets - player.incorrectSelections;
    st.lastSetBy = playerId;
    broadcastEvent(room, 'set', player);

    // Release the call lock — set found successfully.
    clearCallLock(room);

    // If no set exists now, the game is over.
    if (deck.length === 0 && !hasSet) {
      st.status = 'finished';
    }
  } else {
    // Penalise: remove the 3 neg cards from the board (replaced from deck if
    // possible, otherwise the board shrinks), then clear selection.
    const negIds = new Set([a.id, b.id, c.id]);
    const deck = st.deck.slice();
    const board: Card[] = [];
    for (const boardCard of st.board) {
      if (negIds.has(boardCard.id)) {
        if (deck.length > 0) {
          board.push(deck.shift()!);
        }
        // deck empty — slot dropped, board shrinks
      } else {
        board.push(boardCard);
      }
    }
    st.board = board;
    st.deck = deck;
    st.selections[playerId] = [];

    // Remove ghost references from other players' selections.
    const boardIds = new Set(board.map((bc) => bc.id));
    for (const pid of Object.keys(st.selections)) {
      if (pid !== playerId) {
        st.selections[pid] = st.selections[pid].filter((sc) => boardIds.has(sc.id));
      }
    }

    player.incorrectSelections += 1;
    player.score = player.correctSets - player.incorrectSelections;
    st.lastSetBy = null;
    broadcastEvent(room, 'neg', player);

    // Release the call lock — player was penalised.
    clearCallLock(room);

    // Check if the game should end after removing neg cards.
    const hasSetAfterNeg = findSet(board) !== null;
    if (deck.length === 0 && !hasSetAfterNeg) {
      st.status = 'finished';
    }
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

  const { board, deck } = dealInitialBoard();
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
    broadcastEvent(room, 'reconnect', player);
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
      const player = room.state.players[0];
      send(ws, { type: 'joined', playerId: player.id, roomId: room.state.roomId });
      broadcast(room, { type: 'room_state', state: room.state });
      broadcastEvent(room, 'join', player);
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
    const player = room.state.players.find(p => p.id === ws.playerId)!;
    send(ws, { type: 'joined', playerId: player.id, roomId });
    broadcast(room, { type: 'room_state', state: room.state });
    broadcastEvent(room, 'join', player);
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
    const player = room.state.players.find((p) => p.id === ws.playerId);
    ws.intentionalClose = true; // prevent handleClose from re-processing this socket
    evictPlayer(room, ws.playerId!);
    ws.close();
    if (player) {
      broadcastEvent(room, 'leave', player);
    }
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

    const player = st.players.find((p) => p.id === ws.playerId);
    if (!player) {
      send(ws, { type: 'error', message: 'Player not found' });
      return;
    }

    st.callerLockId = ws.playerId;
    broadcast(room, { type: 'room_state', state: room.state });
    broadcastEvent(room, 'call', player);

    // After a timeout, release the lock.
    room.callLockTimer = setTimeout(() => {
      if (st.callerLockId !== ws.playerId) {
        return; // Lock was already released (e.g., by a successful set).
      }
      st.callerLockId = null;
      // Also penalise the player for not completing the set in time.
      player.incorrectSelections += 1;
      player.score = player.correctSets - player.incorrectSelections;
      st.selections[player.id] = [];

      broadcast(room, { type: 'room_state', state: room.state });
      broadcastEvent(room, 'timeout', player);
    }, CALL_SET_LOCK_MS);
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
    // evictPlayer already calls scheduleEmptyRoomDeletion if the room is
    // now empty — no need to call rooms.delete() here directly.
  }, RECONNECT_GRACE_MS);
  room.reconnectTimers.set(playerId, timer);

  // If there are still live sockets, tell them immediately so the UI can
  // show "Player X disconnected".
  if (room.sockets.size > 0) {
    broadcast(room, { type: 'room_state', state: room.state });
  }
}

// ── Main server setup ─────────────────────────────────────────────────────────

export function attachWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    ws.on('message', (msg) => handleMessage(ws as GameSocket, msg.toString()));
    ws.on('close', () => handleClose(ws as GameSocket));
  });
}

// ── Standalone mode ──────────────────────────────────────────────────────────
// When this file is the main entry point (e.g. `node ws-server.mjs`), spin up
// a lightweight HTTP + WebSocket server without Angular SSR / Express.

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain || process.env['WS_STANDALONE'] === '1') {
  const PORT = Number(process.env['PORT']) || 3000;
  const CERT_PATH = `/etc/letsencrypt/live/34.44.229.168.sslip.io/fullchain.pem`;
  const KEY_PATH  = `/etc/letsencrypt/live/34.44.229.168.sslip.io/privkey.pem`;

  const requestHandler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    // CORS headers so the Vercel-hosted frontend can reach this server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SET Game — WebSocket server is running');
  };

  // Use HTTPS/WSS if certs are present, otherwise fall back to plain HTTP/WS.
  let httpServer: HttpServer;
  let usingTls = false;
  try {
    const cert = readFileSync(CERT_PATH);
    const key  = readFileSync(KEY_PATH);
    httpServer = createHttpsServer({ cert, key }, requestHandler) as unknown as HttpServer;
    usingTls = true;
    console.log(`🔒 TLS certs loaded — using HTTPS/WSS`);
  } catch {
    console.warn(`⚠️  TLS certs not found — falling back to HTTP/WS`);
    httpServer = createServer(requestHandler);
  }

  attachWebSocketServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    const proto = usingTls ? 'wss' : 'ws';
    console.log(`🚀 Standalone WS server listening on 0.0.0.0:${PORT}`);
    console.log(`   External: ${proto}://34.44.229.168.sslip.io:${PORT}`);
  });
}
