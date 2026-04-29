import { Component, OnInit, Inject, PLATFORM_ID, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SERVER_ORIGIN } from './server.config';
import { ThemeToggleComponent } from './theme-toggle.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, ThemeToggleComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  maxPlayers = 2;
  /** Options rendered in the player-count selector. Defined here to avoid
   *  allocating a new array on every change-detection cycle. */
  readonly playerCountOptions = [2, 3, 4, 5, 6, 7, 8];
  playerName = '';
  gamesPlayed: number | null = null;
  statsReady = false;

  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object,
  ) {
    if (isPlatformBrowser(this.platformId)) {
      this.playerName = localStorage.getItem('playerName') ?? '';
    }
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const statsUrl = location.hostname === 'localhost' ? `${SERVER_ORIGIN}/api/stats` : '/api/stats';
    fetch(statsUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { totalGamesPlayed: number }) => {
        if (typeof d.totalGamesPlayed === 'number') this.gamesPlayed = d.totalGamesPlayed;
      })
      .catch((err) => console.warn('[stats] Could not load game count', err))
      .finally(() => { this.statsReady = true; this.cdr.markForCheck(); });
  }

  startSinglePlayer(): void {
    this.router.navigate(['/game']);
  }

  createRoom(): void {
    this.savePreferences();
    this.router.navigate(['/room', 'new'], {
      queryParams: { maxPlayers: this.maxPlayers, playerName: this.playerName.trim() || null },
    });
  }

  joinRoom(roomId: string): void {
    if (!roomId.trim()) return;
    this.savePreferences();
    this.router.navigate(['/room', roomId.trim()], {
      queryParams: { playerName: this.playerName.trim() || null },
    });
  }

  private savePreferences(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const name = this.playerName.trim();
    if (name) localStorage.setItem('playerName', name);
  }
}
