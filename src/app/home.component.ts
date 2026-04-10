import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
})
export class HomeComponent {
  maxPlayers = 2;
  /** Options rendered in the player-count selector. Defined here to avoid
   *  allocating a new array on every change-detection cycle. */
  readonly playerCountOptions = [2, 3, 4, 5, 6, 7, 8];
  playerName = '';

  constructor(private router: Router) {
    // Pre-fill from localStorage if the user has played before.
    if (typeof localStorage !== 'undefined') {
      this.playerName = localStorage.getItem('playerName') ?? '';
    }
  }

  startSinglePlayer(): void {
    this.router.navigate(['/game']);
  }

  createRoom(): void {
    this.savePlayerName();
    this.router.navigate(['/room', 'new'], {
      queryParams: { maxPlayers: this.maxPlayers, playerName: this.playerName.trim() || null },
    });
  }

  joinRoom(roomId: string): void {
    if (!roomId.trim()) return;
    this.savePlayerName();
    this.router.navigate(['/room', roomId.trim()], {
      queryParams: { playerName: this.playerName.trim() || null },
    });
  }

  private savePlayerName(): void {
    const name = this.playerName.trim();
    if (name && typeof localStorage !== 'undefined') {
      localStorage.setItem('playerName', name);
    }
  }
}
