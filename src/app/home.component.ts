import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
export class HomeComponent implements OnInit {
  maxPlayers = 2;
  /** Options rendered in the player-count selector. Defined here to avoid
   *  allocating a new array on every change-detection cycle. */
  readonly playerCountOptions = [2, 3, 4, 5, 6, 7, 8];
  playerName = '';
  gamesPlayed: number | null = null;

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: object,
  ) {
    // Pre-fill from localStorage if the user has played before.
    if (typeof localStorage !== 'undefined') {
      this.playerName = localStorage.getItem('playerName') ?? '';
    }
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    fetch('https://34.44.229.168.sslip.io:3000/api/stats')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: { totalGamesPlayed: number }) => {
        if (typeof d.totalGamesPlayed === 'number') this.gamesPlayed = d.totalGamesPlayed;
      })
      .catch(() => {});
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
