# SET Game

A full-stack implementation of the card game [SET](https://en.wikipedia.org/wiki/Set_(card_game)), built with Angular 21. Playable solo or in real-time multiplayer rooms, deployed on Vercel and Google Cloud.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (standalone components), TypeScript, RxJS, Tailwind CSS |
| Backend | Node.js, Express 5, `ws` (WebSockets) |
| SSR | `@angular/ssr` + Angular Node App Engine |
| Testing | Vitest + jsdom |
| Hosting | Vercel (frontend) · Google Cloud VM (WebSocket server) | 

---

## What's in it

**Real-time multiplayer** — custom WebSocket protocol with a typed message schema shared between client and server. Includes a "Call SET" exclusive lock: one player claims the board for 5 seconds; a miss penalises them and releases it. Disconnected players are held in their slot for 5 minutes and can rejoin seamlessly.

**Mode-agnostic UI via dependency injection** — `GameBoardComponent` depends only on a `GameSession` interface (`state$`, `selectCard()`, `callSet()`). Angular's DI injects `SetGameService` for solo play and `MultiplayerGameSession` for multiplayer. The component has zero knowledge of which mode it's in.

**Immutable state machine** — all game logic lives in plain functions with no Angular or browser dependencies. `selectCard(state, card)` returns a new state object and never mutates. Easy to test in isolation and safe to run on the server.

**O(n²) set-finder** — instead of checking every triple (O(n³)), `findSet` iterates over card pairs and derives the unique completing card mathematically from the ID encoding, then does a hash-map lookup. On a 12-card board: ~66 checks instead of ~220.

**Custom HSV colour picker** — card colours and selection highlight are fully customisable via a colour picker drawn on an HTML `<canvas>`. Includes a Euclidean RGB distance check to warn when two card colours are too similar to distinguish.

**Server-Side Rendering** — Angular SSR pre-renders HTML on the server before sending it to the browser. Browser-only APIs (`window`, `localStorage`) are guarded with `isPlatformBrowser` throughout.

---

## Running Locally

```powershell
npm install
npm start          # dev server at http://localhost:4200
npm test           # unit tests (Vitest)
```

```powershell
npm run build
npm run serve:ssr:set-game   # production SSR server at http://localhost:4000
```

