/**
 * ws-server.ts
 *
 * Self-contained WebSocket game-room server.
 * Attach to an existing Node http.Server via `attachWebSocketServer(httpServer)`.
 *
 * Protocol (shared with the client via game.types.ts):
 *   Client → Server  ClientMessage  { join | select_card | new_game }
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
 *      → server resets room (only allowed when status is 'active' or 'finished')
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
const MIN_PLAYERS = 2;
const MAX_PLAYERS_LIMIT = 8; // hard ceiling — one deck supports up to 8 comfortably

// ── In-memory store ──────────────────────────────────────────────────────────

/** Live WebSocket connection annotated with game identity. */
type GameSocket = WebSocket & {
  playerId?: PlayerId;
  roomId?: string;
};

/** Everything the server needs to know about a room. */
interface Room {
  state: RoomState;
  /** playerId → socket */
  sockets: Map<PlayerId, GameSocket>;
}

const rooms = new Map<string, Room>();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cryptographically random URL-safe ID.
 * Uses node:crypto so it's unpredictable even for player IDs used as auth tokens.
 */
function randomId(byteLength = 4): string {
  return randomBytes(byteLength).toString('hex'); // 4 bytes → 8 hex chars
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room: Room, msg: ServerMessage): void {
  // Serialise once — every recipient gets the exact same JSON snapshot.
  // This also prevents any mid-loop mutation from producing divergent state.
  const json = JSON.stringify(msg);
  for (const ws of room.sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

/**
 * Deal initial 12 cards from a freshly shuffled deck.
 * Returns { board, deck } where deck is the remainder.
 */
function dealInitial(): { board: Card[]; deck: Card[] } {
  const full = shuffle(generateDeck());
  return { board: full.slice(0, BOARD_SIZE), deck: full.slice(BOARD_SIZE) };
}

/**
 * After removing 3 set cards, refill board to BOARD_SIZE from the deck
 * (in-place mutation of board + deck arrays that are already copies).
 */
function refillBoard(board: Card[], deck: Card[]): void {
  while (board.length < BOARD_SIZE && deck.length > 0) {
    board.push(deck.shift()!);
  }
}

// ── Room actions ─────────────────────────────────────────────────────────────

function createRoom(creatorSocket: GameSocket, playerName: string, maxPlayers: number): Room {
  const roomId = randomId(3);   // 3 bytes → 6 hex chars — short, shareable room code
  const playerId = randomId(8); // 8 bytes → 16 hex chars — harder to guess

  creatorSocket.playerId = playerId;
  creatorSocket.roomId = roomId;

  const player: Player = { id: playerId, name: playerName, score: 0, correctSets: 0 };

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

  const room: Room = { state, sockets: new Map([[playerId, creatorSocket]]) };
  rooms.set(roomId, room);
  return room;
}

function joinRoom(
  room: Room,
  joinerSocket: GameSocket,
  playerName: string,
): void {
  const playerId = randomId(8);
  joinerSocket.playerId = playerId;
  joinerSocket.roomId = room.state.roomId;

  const newPlayer: Player = { id: playerId, name: playerName, score: 0, correctSets: 0 };
  const st = room.state;

  // Append the new player — works for any N.
  st.players = [...st.players, newPlayer];
  st.selections[playerId] = [];

  room.sockets.set(playerId, joinerSocket);

  // Start the game only once the room is full.
  if (st.players.length >= st.maxPlayers) {
    st.status = 'active';
    const { board, deck } = dealInitial();
    st.board = board;
    st.deck = deck;
  }
}

function applySelection(room: Room, playerId: PlayerId, cardId: string): void {
  const st = room.state;
  const selection = st.selections[playerId];
  if (!selection) return;
  if (st.status !== 'active') return;

  const card = st.board.find((c) => c.id === cardId);
  if (!card) return;

  // Toggle off if already selected.
  const alreadyIdx = selection.findIndex((c) => c.id === cardId);
  if (alreadyIdx >= 0) {
    selection.splice(alreadyIdx, 1);
    return;
  }

  // Max 3 — reset and start fresh if at cap.
  if (selection.length >= 3) {
    st.selections[playerId] = [card];
    return;
  }

  selection.push(card);

  if (selection.length < 3) return;

  // Evaluate the set.
  const [a, b, c] = selection;
  const player = st.players.find((p) => p.id === playerId)!;

  if (isSet(a, b, c)) {
    // Remove the three cards from the board.
    const setIds = new Set([a.id, b.id, c.id]);
    const deck = st.deck.slice();
    const board = st.board
      .map((boardCard) => {
        if (setIds.has(boardCard.id) && deck.length > 0) {
          return deck.shift()!;
        }
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

    // Check if deck + board exhausted → game over.
    if (st.board.length === 0 && st.deck.length === 0) {
      st.status = 'finished';
    }
  } else {
    // Incorrect set.
    st.selections[playerId] = [];
    player.score = Math.max(0, player.score + SCORE_INCORRECT);
    st.lastSetBy = null;
  }
}

function resetRoom(room: Room): void {
  const st = room.state;
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

  if (msg.type === 'join') {
    const { roomId, playerName } = msg;
    // Clamp maxPlayers to a sensible range; only relevant when creating a room.
    const maxPlayers = Math.min(
      Math.max(Math.floor(msg.maxPlayers ?? MIN_PLAYERS), MIN_PLAYERS),
      MAX_PLAYERS_LIMIT,
    );

    if (!playerName?.trim()) {
      send(ws, { type: 'error', message: 'playerName is required' });
      return;
    }

    if (roomId === 'new') {
      // Create a brand new room.
      const room = createRoom(ws, playerName.trim(), maxPlayers);
      const pid = ws.playerId!;
      send(ws, { type: 'joined', playerId: pid, roomId: room.state.roomId });
      broadcast(room, { type: 'room_state', state: room.state });
      return;
    }

    // Join an existing room.
    const room = rooms.get(roomId);
    if (!room) {
      send(ws, { type: 'error', message: `Room ${roomId} not found` });
      return;
    }
    if (room.state.status !== 'waiting') {
      send(ws, { type: 'error', message: 'Room is full or already finished' });
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

  if (msg.type === 'select_card') {
    applySelection(room, ws.playerId, msg.cardId);
    broadcast(room, { type: 'room_state', state: room.state });
    return;
  }

  if (msg.type === 'new_game') {
    if (room.state.players.length < MIN_PLAYERS) {
      send(ws, { type: 'error', message: `Need at least ${MIN_PLAYERS} players to start a new game` });
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

  const room = rooms.get(ws.roomId);
  if (!room) return;

  room.sockets.delete(ws.playerId);

  // If the room now has no live connections, clean it up after a short grace
  // period so a quick reconnect can still find it.
  if (room.sockets.size === 0) {
    setTimeout(() => {
      if (rooms.get(ws.roomId!)?.sockets.size === 0) {
        rooms.delete(ws.roomId!);
      }
    }, 30_000);
    return;
  }

  // If too few players remain to continue, mark the room finished and notify
  // everyone still connected. For a 4-player room this means 3 can't play on.
  if (room.sockets.size < MIN_PLAYERS) {
    room.state.status = 'finished';
  }
  broadcast(room, { type: 'room_state', state: room.state });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Attach a WebSocket server to an existing http.Server.
 * WebSocket connections arrive on the same port as Express — no second port needed.
 *
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
