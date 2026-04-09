import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'game',
    loadComponent: () =>
      import('./game-board.component').then((m) => m.GameBoardComponent),
  },
  {
    // GameRoomComponent is added in step 8.
    // Declaring the route now means the router knows the shape of /room/:roomId
    // and HomeComponent can navigate to it without 404s.
    path: 'room/:roomId',
    loadComponent: () =>
      import('./game-board.component').then((m) => m.GameBoardComponent),
  },
  // Catch-all: redirect unknown paths to home.
  { path: '**', redirectTo: '' },
];
