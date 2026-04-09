import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The game board is stateful — render it on the server per request, not at build time.
  { path: 'game', renderMode: RenderMode.Server },
  // Everything else (future static pages) can be prerendered.
  { path: '**',   renderMode: RenderMode.Prerender },
];
