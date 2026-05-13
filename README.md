# SET Game

A full-stack implementation of the card game [SET](https://en.wikipedia.org/wiki/Set_(card_game)) — playable solo or in real-time multiplayer rooms.

**[playsetgame.vercel.app](https://playsetgame.vercel.app)**

---

## Stack

| Layer | |
|---|---|
| Frontend | Angular 21, TypeScript, Tailwind CSS |
| Backend | Node.js, Express 5, native WebSockets (`ws`) |
| Database | SQLite (`better-sqlite3`) |
| Hosting | Vercel (frontend + Edge functions) · Google Cloud VM, PM2, Let's Encrypt TLS (WebSocket server) |

---

## How it's built

**Cards rendered as SVG** — no images. Every shape (pill, diamond, squiggle) is drawn programmatically; striped shading uses an SVG `<pattern>`. Scales to any size without pixelation.

**Mode-agnostic UI** — `GameBoardComponent` depends only on a `GameSession` interface (`state$`, `selectCard()`, `callSet()`). Angular's DI injects `SetGameService` for solo play and `MultiplayerGameSession` for multiplayer. The component has zero knowledge of which mode it's in.

**Immutable state machine** — all game logic lives in pure functions with no framework dependencies. `selectCard(state, card)` returns a new state object and never mutates. The same functions run on client and server.

**O(n²) set-finder** — instead of checking every triple (O(n³), ~220 checks on a 12-card board), `findSet` iterates over pairs. For any two cards the unique completing third is mathematically determined from the attribute encoding (`thirdAttr(a, b) = a === b ? a : 6 - a - b`), then looked up by ID in a hash map. ~66 checks instead of ~220.

**Custom canvas colour picker** — card colours are fully customisable via an HSV picker drawn on an HTML `<canvas>`, with a Euclidean RGB distance check to warn when two colours are too similar to distinguish.

**Real-time multiplayer** — custom WebSocket protocol with typed messages shared between client and server. Includes a "Call SET" lock (one player claims the board for 7 seconds), reconnect grace periods, and server-side game stat recording to SQLite.
---
