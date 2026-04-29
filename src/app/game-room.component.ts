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
import { ThemeToggleComponent } from './theme-toggle.component';
import { GAME_SESSION } from './game-session.interface';
import { Player, PlayerId, GameEvent, PLAYER_COLORS_LIGHT, PLAYER_COLORS_DARK } from './game.types';
import { ThemeService } from './theme.service';
import { generateDefaultPlayerName } from './game.utils';

@Component({
  selector: 'app-game-room',
  standalone: true,
  imports: [CommonModule, FormsModule, GameBoardComponent, ThemeToggleComponent],
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
  /** The PlayerId of whoever just found a set — used to pulse their score chip. */
  lastSetBy: PlayerId | null = null;
  /** The PlayerId of whoever just got penalised — used to flash their score chip red. */
  lastNegBy: PlayerId | null = null;
  maxPlayers = 2;
  /** Feed of recent actions in the room. */
  events: GameEvent[] = [];
  /** IDs of feed items currently fading out before DOM removal. */
  fadingEventIds = new Set<string>();

  /** Tracks clipboard copy state for the "Copy" button label. */
  copyState: 'idle' | 'copied' | 'failed' = 'idle';
  private copyStateTimeout: ReturnType<typeof setTimeout> | null = null;
  private fadeTimers = new Set<ReturnType<typeof setTimeout>>();

  private subs = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public session: MultiplayerGameSession,
    public themeService: ThemeService,
    @Inject(PLATFORM_ID) private platformId: object,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Use the name passed from the home screen, then fall back to a
    // previously saved name, then generate a random default.
    const nameFromQuery = this.route.snapshot.queryParamMap.get('playerName')?.trim();
    this.playerName =
      nameFromQuery || localStorage.getItem('playerName') || generateDefaultPlayerName();
    // Persist so direct room links and reconnects remember the name.
    if (this.playerName) localStorage.setItem('playerName', this.playerName);

    const roomId = this.route.snapshot.paramMap.get('roomId') ?? 'new';
    // maxPlayers is passed as a query param when creating a room: /room/new?maxPlayers=4
    // Clamp to [2, 8] and fall back to 2 for absent / non-numeric / out-of-range values.
    const rawMax = Number(this.route.snapshot.queryParamMap.get('maxPlayers'));
    this.maxPlayers = Number.isFinite(rawMax) && rawMax >= 2 && rawMax <= 8
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

    // Chip highlight — no banner, just the score chip pulse.
    this.subs.add(
      this.session.lastSetBy$.subscribe((id) => {
        this.lastSetBy = id;
        this.cdr.markForCheck();
      }),
    );

    this.subs.add(
      this.session.negSetBy$.subscribe((id) => {
        this.lastNegBy = id;
        this.cdr.markForCheck();
      }),
    );

    this.subs.add(
      this.session.events$.subscribe(event => {
        this.events.unshift(event);
        if (this.events.length > 5) this.events.pop();
        // Fade out, then remove from DOM. Both timers are tracked so ngOnDestroy
        // can cancel them if the component is torn down before they fire.
        const fadeTimer = setTimeout(() => {
          this.fadeTimers.delete(fadeTimer);
          this.fadingEventIds.add(event.id);
          this.cdr.markForCheck();
          const removeTimer = setTimeout(() => {
            this.fadeTimers.delete(removeTimer);
            this.fadingEventIds.delete(event.id);
            const idx = this.events.findIndex(e => e.id === event.id);
            if (idx >= 0) this.events.splice(idx, 1);
            this.cdr.markForCheck();
          }, 400);
          this.fadeTimers.add(removeTimer);
        }, 4600);
        this.fadeTimers.add(fadeTimer);
        this.cdr.markForCheck();
      }),
    );

    this.subs.add(
      this.themeService.theme$.subscribe(() => this.cdr.markForCheck()),
    );

    this.session.connect(roomId, this.playerName, this.maxPlayers);
  }

  ngOnDestroy(): void {
    if (this.copyStateTimeout) clearTimeout(this.copyStateTimeout);
    for (const t of this.fadeTimers) clearTimeout(t);
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
        this.scheduleCopyReset(2000);
      },
      () => {
        // Clipboard API denied (HTTP, permissions policy, etc.) — show the
        // failure so the user knows to copy the code manually.
        this.copyState = 'failed';
        this.cdr.markForCheck();
        this.scheduleCopyReset(3000);
      },
    );
  }

  private scheduleCopyReset(ms: number): void {
    if (this.copyStateTimeout) clearTimeout(this.copyStateTimeout);
    this.copyStateTimeout = setTimeout(() => { this.copyState = 'idle'; this.cdr.markForCheck(); }, ms);
  }

  // ── Colour helpers ────────────────────────────────────────────────────────

  colorFor(colorIndex: number): string {
    const palette = this.themeService.current === 'dark' ? PLAYER_COLORS_DARK : PLAYER_COLORS_LIGHT;
    return palette[colorIndex % palette.length];
  }

  get overlayStatus(): string {
    return this.roomStatus === 'error' ? 'disconnected' : this.roomStatus;
  }

  // ── TrackBy helpers ───────────────────────────────────────────────────────

  trackPlayer(_index: number, player: Player): PlayerId { return player.id; }
  trackEvent(_index: number, event: GameEvent): string { return event.id; }

  actionText(type: GameEvent['type']): string {
    switch (type) {
      case 'call':       return 'called SET';
      case 'set':        return 'found a SET';
      case 'neg':        return 'negged';
      case 'timeout':    return 'timed out';
      case 'join':       return 'joined';
      case 'leave':      return 'left';
      case 'reconnect':  return 'reconnected';
      case 'disconnect': return 'disconnected';
    }
  }

  isStructuralEvent(type: GameEvent['type']): boolean {
    return type === 'join' || type === 'leave' || type === 'reconnect' || type === 'disconnect';
  }

  // ── Scoreboard helpers ────────────────────────────────────────────────────

  isWinner(player: Player, players: Player[]): boolean {
    if (players.length === 0) return false;
    const top = Math.max(...players.map(p => p.correctSets - p.incorrectSelections));
    return top > 0 && (player.correctSets - player.incorrectSelections) === top;
  }
}
