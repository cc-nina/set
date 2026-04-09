import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Home screen is static — prerender it for instant first paint.
  { path: '',              renderMode: RenderMode.Prerender },
  // Game board is stateful — server-render per request (never prerender).
  { path: 'game',          renderMode: RenderMode.Server },
  // Room routes are dynamic and stateful — server-render per request.
  { path: 'room/:roomId',  renderMode: RenderMode.Server },
  // Fallback.
  { path: '**',            renderMode: RenderMode.Prerender },
];
