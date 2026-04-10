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
import { PlayerId, Player, GameEvent } from './game.types';
import { generateDefaultPlayerName } from './game.utils';

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
  /** Feed of recent actions in the room. */
  events: GameEvent[] = [];

  /** Cached player list — updated by the players$ subscription so the
   *  lastSetBy$ handler can look up names without creating a nested subscribe. */
  private latestPlayers: Player[] = [];

  /** Tracks clipboard copy state for the "Copy" button label. */
  copyState: 'idle' | 'copied' | 'failed' = 'idle';

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

    // Restore the saved name, or generate a neutral default on first visit.
    this.playerName =
      localStorage.getItem('playerName') ?? generateDefaultPlayerName();

    const roomId = this.route.snapshot.paramMap.get('roomId') ?? 'new';
    // maxPlayers is passed as a query param when creating a room: /room/new?maxPlayers=4
    // Clamp to [2, 8] and fall back to 2 for absent / non-numeric / out-of-range values.
    const rawMax = Number(this.route.snapshot.queryParamMap.get('maxPlayers'));
    const maxPlayers = Number.isFinite(rawMax) && rawMax >= 2 && rawMax <= 8
      ? Math.floor(rawMax)
      : 2;

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

    // Keep latestPlayers in sync so the lastSetBy$ handler can do a simple
    // array lookup rather than spawning a nested subscription.
    this.subs.add(
      this.session.players$.subscribe((players) => {
        this.latestPlayers = players;
      }),
    );

    // "Player X found a set!" banner.
    this.subs.add(
      this.session.lastSetBy$.subscribe((id) => {
        this.lastSetBy = id;
        if (id) {
          this.lastSetByName =
            this.latestPlayers.find((p) => p.id === id)?.name ?? 'Someone';
        }
        this.cdr.markForCheck();
      }),
    );

    this.subs.add(
      this.session.events$.subscribe(event => {
        this.events.unshift(event);
        // Keep the feed to a reasonable size
        if (this.events.length > 10) {
          this.events.pop();
        }
        this.cdr.markForCheck();
      })
    );

    this.session.connect(roomId, this.playerName, maxPlayers);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    // Do NOT call leave() here — just silently close the socket so the server
    // keeps the player slot alive for the reconnect grace period.
    this.session.disconnect();
  }

  /** Permanently leave the room and go home. Clears the stored session. */
  leaveRoom(): void {
    this.session.leave();
    this.router.navigate(['/']);
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  copyRoomCode(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard.writeText(this.roomCode).then(
      () => {
        this.copyState = 'copied';
        this.cdr.markForCheck();
        setTimeout(() => { this.copyState = 'idle'; this.cdr.markForCheck(); }, 2000);
      },
      () => {
        // Clipboard API denied (HTTP, permissions policy, etc.) — show the
        // failure so the user knows to copy the code manually.
        this.copyState = 'failed';
        this.cdr.markForCheck();
        setTimeout(() => { this.copyState = 'idle'; this.cdr.markForCheck(); }, 3000);
      },
    );
  }

  // Action feed helpers
  trackEvent(index: number, event: GameEvent): string { return event.id; }
  isStale(event: GameEvent): boolean { return Date.now() - event.timestamp > 5000; }
  actionText(type: GameEvent['type']): string {
    switch (type) {
      case 'call': return 'called SET';
      case 'set': return 'found a SET';
      case 'neg': return 'negged';
      case 'timeout': return 'timed out';
      case 'join': return 'joined';
      case 'leave': return 'left';
      case 'reconnect': return 'reconnected';
    }
  }
}
