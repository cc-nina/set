import { Routes } from '@angular/router';
import { GameBoardComponent } from './game-board.component';

export const routes: Routes = [
  // Default route — redirect bare "/" to the single-player game for now.
  // Once the HomeComponent exists this will become the mode-selection screen.
  { path: '',      redirectTo: 'game', pathMatch: 'full' },
  { path: 'game',  component: GameBoardComponent },
  // Future routes added here:
  //   { path: '',              component: HomeComponent },
  //   { path: 'room/:roomId',  component: GameRoomComponent },
];
