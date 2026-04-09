import {
  Component,
  OnInit,
  OnDestroy,
  Inject,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { GameBoardComponent } from './game-board.component';
import { MultiplayerGameSession } from './multiplayer-game-session';
import { GAME_SESSION } from './game-session.interface';
import { PlayerId } from './game.types';

@Component({
  selector: 'app-game-room',
  standalone: true,
  imports: [CommonModule, FormsModule, GameBoardComponent],
  /**
   * Provide MultiplayerGameSession under the GAME_SESSION token so that
   * GameBoardComponent (which injects GAME_SESSION) gets the multiplayer
   * implementation automatically — no changes to GameBoardComponent needed.
   */
  providers: [
    MultiplayerGameSession,
    { provide: GAME_SESSION, useExisting: MultiplayerGameSession },
  ],
  templateUrl: './game-room.component.html',
  styleUrls: ['./game-room.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameRoomComponent implements OnInit, OnDestroy {
  // ── Template state ────────────────────────────────────────────────────────
  playerName = '';
  roomStatus = 'connecting';
  /** The 6-char room code shown to the user to share with others. */
  roomCode = '';
  /** The PlayerId of whoever just found a set (for the banner). */
  lastSetBy: PlayerId | null = null;
  /** Display name of whoever just found a set. */
  lastSetByName = '';

  private subs = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public session: MultiplayerGameSession,
    @Inject(PLATFORM_ID) private platformId: object,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Restore or prompt for player name.
    this.playerName =
      sessionStorage.getItem('playerName') ?? this.promptName();

    const roomId = this.route.snapshot.paramMap.get('roomId') ?? 'new';

    // Track the server-assigned room ID (needed when URL was 'new').
    this.subs.add(
      this.session.roomId$.subscribe((id) => {
        if (id && id !== this.roomCode) {
          this.roomCode = id;
          // Replace the URL so sharing/refreshing works.
          this.router.navigate(['/room', id], { replaceUrl: true });
          this.cdr.markForCheck();
        }
      }),
    );

    // Track room status for the overlay.
    this.subs.add(
      this.session.roomStatus$.subscribe((status) => {
        this.roomStatus = status;
        this.cdr.markForCheck();
      }),
    );

    // "Player X found a set!" banner.
    this.subs.add(
      this.session.lastSetBy$.subscribe((id) => {
        this.lastSetBy = id;
        if (id) {
          const player = this.session.getStateSnapshot();
          // Look up name from players$ snapshot.
          this.session.players$.subscribe((players) => {
            this.lastSetByName = players.find((p) => p.id === id)?.name ?? 'Someone';
          }).unsubscribe();
        }
        this.cdr.markForCheck();
      }),
    );

    this.session.connect(roomId, this.playerName);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  copyRoomCode(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard.writeText(this.roomCode).catch(() => {});
  }

  private promptName(): string {
    const name =
      (isPlatformBrowser(this.platformId)
        ? window.prompt('Enter your name') ?? ''
        : '') || 'Player';
    sessionStorage.setItem('playerName', name);
    return name;
  }
}
