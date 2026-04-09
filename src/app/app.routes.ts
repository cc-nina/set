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
    path: 'room/:roomId',
    loadComponent: () =>
      import('./game-room.component').then((m) => m.GameRoomComponent),
  },
  // Catch-all: redirect unknown paths to home.
  { path: '**', redirectTo: '' },
];
