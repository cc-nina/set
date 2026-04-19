import {
  Component,
  Inject,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ViewChild,
  HostListener,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { CardComponent } from './card.component';
import { PaletteModalComponent, PaletteChangeEvent } from './palette-modal.component';
import { GameSession, GAME_SESSION } from './game-session.interface';
import { Card, CALL_SET_SECONDS } from './game.types';
import { shapeFor, shadingFor } from './game.utils';
import { ThemeService } from './theme.service';

/** How long (ms) the set-match highlight stays visible before cards are replaced. */
const SET_MATCH_DISPLAY_MS = 700;

/** How long (ms) the neg-set shake animation plays before the new board lands. */
const NEG_MATCH_DISPLAY_MS = 700;

/** How long (ms) each tick interval is for the countdown. */
const COUNTDOWN_TICK_MS = 100;

/** Gap between cards as a fraction of card width. */
const GAP_RATIO = 0.1;

@Component({
  selector: 'app-game-board',
  standalone: true,
  imports: [CommonModule, DecimalPipe, CardComponent, PaletteModalComponent],
  templateUrl: './game-board.component.html',
  styleUrls: ['./game-board.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameBoardComponent implements OnInit, OnDestroy {
  board: Card[] = [];
  palette: string[] = [];
  selectedIds: Set<string> = new Set();

  /** Cards that were just identified as a valid set — show match animation. */
  setMatchIds: Set<string> = new Set();
  /** Cards that were just part of an incorrect selection (neg) — show shake animation. */
  negMatchIds: Set<string> = new Set();

  /** Timeout handle for clearing negMatchIds — tracked so rapid negs don't stomp each other. */
  private negMatchTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Timeout handle for clearing setMatchIds after the match animation. */
  private setMatchTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Snapshot of the board from the previous state emission.
   * Used by the set-match animation to diff which cards were removed so the
   * old board can be temporarily restored during the flash.
   * Only updated when no set-match animation is running.
   */
  private prevBoard: Card[] = [];

  /** Card IDs of the most recent incorrect selection — used by the neg animation. */
  private lastNegCardIds: string[] | null = null;

  /** Colour used for the selection border ring. Stored locally (UI-only). */
  highlightColor: string = '#000000';
  /** 'finished' once no valid sets remain and the deck is exhausted. */
  gameStatus: 'active' | 'finished' = 'active';

  /** Live stats shown in the toolbar while playing. */
  liveSets = 0;
  liveNegs = 0;
  liveScore = 0;

  /** Final score snapshot shown on the game-over overlay. */
  finalScore = 0;
  finalSets = 0;
  finalNegs = 0;

  isBrowser = true;
  showBoard = false;
  orientation: 'portrait' | 'landscape' = 'portrait';
  gridClasses = 'grid-cols-3';
  /** Inline style object for the card grid — sets gap to card-width × GAP_RATIO. */
  gridStyle: Record<string, string> = {};
  /** Current card gap in px — used to match toolbar padding to card spacing. */
  cardGap = 0;

  showPaletteModal = false;

  /** Card background colour — resolved from CSS variable, updated on theme change. */
  cardBg = '#ffffff';
  /** Card border colour — resolved from CSS variable, updated on theme change. */
  cardBorder = '#d1d5db';

  private themeSubscription!: Subscription;

  /** Expose constant for template use in countdown bar width calculation. */
  readonly callSetSeconds = CALL_SET_SECONDS;
  /** Whether the LOCAL player has called SET and is currently picking cards. */
  callingSet = false;
  /** Remaining time in seconds (fractional) during the call window. */
  callTimeLeft = CALL_SET_SECONDS;
  /** Interval handle for the countdown ticker. */
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * In multiplayer: the PlayerId of whoever currently holds the call lock
   * (from the server). null when nobody has called.
   * In single-player: always null (lock is local only).
   */
  serverCallerLockId: string | null = null;
  /** The local player's id — populated from GameState.myPlayerId (multiplayer only). */
  private myPlayerId: string | null = null;

  /**
   * True when another player (not us) holds the server lock.
   * Uses the server-authoritative callerLockId compared against our own
   * playerId — not the local callingSet flag, which can lag behind the
   * server during network round-trips.
   */
  get lockedByOther(): boolean {
    if (this.serverCallerLockId === null) return false;
    if (this.myPlayerId !== null) {
      return this.serverCallerLockId !== this.myPlayerId;
    }
    return !this.callingSet;
  }

  @ViewChild('paletteModal') paletteModalRef?: PaletteModalComponent;

  private stateSubscription!: Subscription;
  private lastSetBySubscription!: Subscription;
  private negSetBySubscription!: Subscription;
  private callerLockSubscription!: Subscription;

  /** True when this session is a live multiplayer game. Sourced from the GameSession contract. */
  readonly isMultiplayer: boolean;

  /** Tracks whether the first state emission has been seen (used to defer showBoard). */
  private firstState = true;

  constructor(
    @Inject(GAME_SESSION) public game: GameSession,
    @Inject(PLATFORM_ID) private platformId: object,
    private cdr: ChangeDetectorRef,
    private themeService: ThemeService,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.isMultiplayer = this.game.isMultiplayer;
  }

  ngOnInit(): void {
    this.stateSubscription = this.game.state$.subscribe((s) => {
      // Only update prevBoard when no set-match animation is running — a mid-
      // animation state$ emission must not clobber the snapshot we're diffing from.
      if (this.setMatchTimeout === null) {
        this.prevBoard = this.board;
      }
      this.board = s.board;
      this.lastNegCardIds = s.lastNegCardIds ?? null;
      this.selectedIds = new Set(s.selected.map((c) => c.id));
      this.gameStatus = s.status;

      const prevSets = this.liveSets;
      const prevNegs = this.liveNegs;
      this.liveSets = s.correctSets;
      this.liveNegs = s.incorrectSelections;
      this.liveScore = s.score;

      // Keep our own player id up to date so lockedByOther can compare correctly.
      if (s.myPlayerId !== undefined) this.myPlayerId = s.myPlayerId;

      // When a correct set OR a neg is applied, cancel the local countdown —
      // the call window is over either way.
      if ((s.correctSets > prevSets || s.incorrectSelections > prevNegs) && this.callingSet) {
        if (this.countdownInterval !== null) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        this.callingSet = false;
      }

      if (s.status === 'finished') {
        this.finalScore = s.score;
        this.finalSets = s.correctSets;
        this.finalNegs = s.incorrectSelections;
      }

      if (this.firstState) {
        this.firstState = false;
        this.scheduleShowBoard();
      }

      this.cdr.markForCheck();
    });

    // ── Set-match animation ───────────────────────────────────────────────────
    // lastSetBy$ emits the finder's id when a valid set is applied, then null
    // after LAST_SET_BANNER_MS. By the time this fires, state$ has already
    // updated this.board to the new board; prevBoard holds the pre-removal
    // snapshot. We diff them to find the 3 removed cards, temporarily restore
    // the old board so they're visible during the flash, then land the new board.
    this.lastSetBySubscription = this.game.lastSetBy$.subscribe((id) => {
      if (id === null) {
        // Tear-down signal: clear any lingering highlight.
        this.setMatchIds = new Set();
        this.cdr.markForCheck();
        return;
      }

      const newBoardIds = new Set(this.board.map((c) => c.id));
      const removedCards = this.prevBoard.filter((c) => !newBoardIds.has(c.id));
      if (removedCards.length !== 3) return; // safety guard

      this.setMatchIds = new Set(removedCards.map((c) => c.id));

      // Capture snapshots now — prevBoard may be overwritten by a subsequent
      // state$ emission before the timeout fires.
      const animOldBoard = this.prevBoard.slice();
      const animNewBoard = this.board.slice();
      this.board = animOldBoard;
      this.cdr.markForCheck();

      if (this.setMatchTimeout !== null) clearTimeout(this.setMatchTimeout);
      this.setMatchTimeout = setTimeout(() => {
        this.setMatchIds = new Set();
        this.setMatchTimeout = null;
        this.board = animNewBoard;
        this.cdr.markForCheck();
      }, SET_MATCH_DISPLAY_MS);
    });

    // ── Neg animation ─────────────────────────────────────────────────────────
    // negSetBy$ emits when an incorrect 3-card selection is penalised, then null
    // after the animation window. The neg'd cards stay on the board, so we use
    // lastNegCardIds (set from state$ just before this fires) to identify which
    // 3 cards to shake — no board-swapping needed.
    this.negSetBySubscription = this.game.negSetBy$.subscribe((id) => {
      if (id === null) {
        this.negMatchIds = new Set();
        this.cdr.markForCheck();
        return;
      }

      // Timeout penalties have no neg cards (lastNegCardIds is null).
      if (!this.lastNegCardIds || this.lastNegCardIds.length !== 3) return;

      this.negMatchIds = new Set(this.lastNegCardIds);
      this.cdr.markForCheck();

      if (this.negMatchTimeout !== null) clearTimeout(this.negMatchTimeout);
      this.negMatchTimeout = setTimeout(() => {
        this.negMatchIds = new Set();
        this.negMatchTimeout = null;
        this.cdr.markForCheck();
      }, NEG_MATCH_DISPLAY_MS);
    });

    // ── Caller lock ───────────────────────────────────────────────────────────
    // Subscribe to the server-authoritative call lock so we can disable the
    // Call SET button when another player holds it (multiplayer only).
    // In single-player this stream always emits null and is a no-op.
    this.callerLockSubscription = this.game.callerLockId$.subscribe((lockId) => {
      this.serverCallerLockId = lockId;
      // If the server cleared a lock we held (timeout penalty), cancel the
      // local countdown so the UI stays in sync.
      if (lockId === null && this.callingSet) {
        if (this.countdownInterval !== null) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        this.callingSet = false;
      }
      this.cdr.markForCheck();
    });

    if (this.isBrowser) {
      this.updateLayout();
      this.palette = this.game.getPalette();
      this.readCardTokens();
      // If the user has never customised the highlight colour, seed it from the
      // CSS variable so dark mode gets a readable default automatically.
      const savedHighlight = this.game.highlightColor;
      this.highlightColor = (!savedHighlight || savedHighlight === '#000000' || savedHighlight === '#000')
        ? this.readCssVar('--card-selected-default', '#000000')
        : savedHighlight;
    }

    // Re-read card colour tokens whenever the theme changes.
    this.themeSubscription = this.themeService.theme$.subscribe(() => {
      if (this.isBrowser) {
        // CSS variables are applied synchronously by ThemeService before this
        // fires, so reading them in a microtask is sufficient.
        Promise.resolve().then(() => {
          this.readCardTokens();
          const saved = this.game.highlightColor;
          if (!saved || saved === '#000000' || saved === '#000') {
            this.highlightColor = this.readCssVar('--card-selected-default', '#000000');
          }
          this.cdr.markForCheck();
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.stateSubscription.unsubscribe();
    this.lastSetBySubscription.unsubscribe();
    this.negSetBySubscription.unsubscribe();
    this.callerLockSubscription.unsubscribe();
    this.themeSubscription.unsubscribe();
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.negMatchTimeout !== null) {
      clearTimeout(this.negMatchTimeout);
      this.negMatchTimeout = null;
    }
    if (this.setMatchTimeout !== null) {
      clearTimeout(this.setMatchTimeout);
      this.setMatchTimeout = null;
    }
  }

  // ── Theme helpers ─────────────────────────────────────────────────────────

  /** Read --card-bg and --card-border CSS variables from the document root. */
  private readCardTokens(): void {
    const style = getComputedStyle(document.documentElement);
    this.cardBg     = style.getPropertyValue('--card-bg').trim()     || '#ffffff';
    this.cardBorder = style.getPropertyValue('--card-border').trim() || '#d1d5db';
  }

  /** Read a single CSS variable from the document root, with a fallback. */
  private readCssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Space' && !this.callingSet && !this.lockedByOther && this.gameStatus === 'active') {
      event.preventDefault();
      this.callSet();
    }
  }

  // ── Call-SET mechanic ─────────────────────────────────────────────────────

  callSet(): void {
    if (this.callingSet || this.gameStatus !== 'active') return;
    if (this.lockedByOther) return;
    this.game.callSet();
    this.callingSet = true;
    this.callTimeLeft = CALL_SET_SECONDS;
    this.cdr.markForCheck();

    this.countdownInterval = setInterval(() => {
      this.callTimeLeft = Math.max(0, this.callTimeLeft - COUNTDOWN_TICK_MS / 1000);
      this.cdr.markForCheck();
      if (this.callTimeLeft <= 0) {
        this.cancelCountdown();
      }
    }, COUNTDOWN_TICK_MS);
  }

  private cancelCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.callingSet = false;
    // Delegate post-cancel cleanup to the session — behaviour differs by
    // implementation: single-player deselects cards, multiplayer is a no-op
    // (the server broadcasts the penalty and clears selections via room_state).
    this.game.clearSelectionOnCancel();
    this.cdr.markForCheck();
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  @HostListener('window:resize')
  onResize(): void {
    this.updateLayout();
  }

  trackCard(_: number, c: Card): string {
    return c.id;
  }

  private updateLayout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Desktop: landscape cards (3:2), 4×3 grid, capped at 896px wide.
    // Mobile:  portrait cards (2:3), 4×3 grid, full viewport width.
    const cfg = w >= 768
      ? { orientation: 'landscape' as const, gridClasses: 'grid-cols-4', cols: 4, rows: 3, cardAspect: 180 / 120, maxBoardWidth: 896 }
      : { orientation: 'portrait'  as const, gridClasses: 'grid-cols-4', cols: 4, rows: 3, cardAspect: 120 / 180, maxBoardWidth: Infinity };

    this.orientation = cfg.orientation;
    this.gridClasses = cfg.gridClasses;

    const boardWidth = Math.min(w - 32, cfg.maxBoardWidth);
    const cardWFromWidth = boardWidth / (cfg.cols + GAP_RATIO * (cfg.cols - 1));

    const boardHeight = h - 56;
    const cardHFromHeight = boardHeight / (cfg.rows + GAP_RATIO * (cfg.rows - 1));
    const cardWFromHeight = cardHFromHeight * cfg.cardAspect;

    const cardWidth = Math.floor(Math.min(cardWFromWidth, cardWFromHeight));
    const gap = Math.round(GAP_RATIO * cardWidth);
    this.cardGap = gap;
    this.gridStyle = {
      gap: `${gap}px`,
      'grid-template-columns': `repeat(${cfg.cols}, ${cardWidth}px)`,
    };
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  openPaletteModal(): void {
    this.showPaletteModal = true;
    setTimeout(() => this.paletteModalRef?.initPicker(), 0);
  }

  closePaletteModal(): void {
    this.showPaletteModal = false;
  }

  onPaletteColorChange(event: PaletteChangeEvent): void {
    if (event.index === 3) {
      this.highlightColor = event.color || this.readCssVar('--card-selected-default', '#000000');
      this.game.updateHighlightColor(event.color);
    } else {
      this.game.updatePaletteColor(event.index + 1, event.color);
      this.palette = this.game.getPalette();
    }
  }

  // ── Card helpers ──────────────────────────────────────────────────────────

  onCardClick(card: Card): void {
    // Cards are only selectable while the local countdown is running.
    // In multiplayer: only the player who called SET holds the lock.
    // In single-player: same — must press "Call SET" first.
    if (!this.callingSet) return;
    this.game.selectCard(card);
  }

  getPlayerName(playerId: string | null): string {
    if (!playerId) return '';
    const state = this.game.getStateSnapshot();
    return state.players?.find((p) => p.id === playerId)?.name ?? '';
  }

  shapeFor(c: Card): string {
    return shapeFor(c);
  }

  shadingFor(c: Card): string {
    return shadingFor(c);
  }

  colorFor(c: Card): string {
    const override = this.game.getCardColor(c.id);
    return override ?? this.game.getPaletteColor(c.color) ?? '#DB2C05';
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private scheduleShowBoard(): void {
    setTimeout(() => {
      this.showBoard = true;
      this.cdr.markForCheck();
    }, 50);
  }
}