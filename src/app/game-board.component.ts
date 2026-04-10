import {
  Component,
  Inject,
  PLATFORM_ID,
  ChangeDetectorRef,
  ViewChild,
  HostListener,
  AfterViewInit,
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
import { MultiplayerGameSession } from './multiplayer-game-session';

/** How long (ms) the set-match highlight stays visible before cards are replaced. */
const SET_MATCH_DISPLAY_MS = 250;

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
})
export class GameBoardComponent implements AfterViewInit, OnDestroy {
  board: Card[] = [];
  palette: string[] = [];
  selectedIds: Set<string> = new Set();
  /** Cards that were just identified as a valid set — show match animation. */
  setMatchIds: Set<string> = new Set();
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
  /** True when another player (not us) holds the server lock. */
  get lockedByOther(): boolean {
    return this.serverCallerLockId !== null && !this.callingSet;
  }
  @ViewChild('paletteModal') paletteModalRef?: PaletteModalComponent;

  private stateSubscription!: Subscription;
  private lastSetBySubscription!: Subscription;
  private callerLockSubscription!: Subscription;

  // Multiplayer
  isMultiplayer = false;

  constructor(
    @Inject(GAME_SESSION) public game: GameSession,
    @Inject(PLATFORM_ID) private platformId: object,
    private cdr: ChangeDetectorRef,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);

    let first = true;
    // Snapshot of the board from the previous state$ emission — used by the
    // lastSetBy$ subscriber to diff which cards were removed.
    let prevBoard: Card[] = [];

    this.stateSubscription = this.game.state$.subscribe((s) => {
      prevBoard = this.board; // capture BEFORE overwriting
      this.board = s.board;
      this.selectedIds = new Set(s.selected.map((c) => c.id));
      this.gameStatus = s.status;
      this.liveSets = s.correctSets;
      this.liveNegs = s.incorrectSelections;
      this.liveScore = s.score;
      if (s.status === 'finished') {
        this.finalScore = s.score;
        this.finalSets = s.correctSets;
        this.finalNegs = s.incorrectSelections;
      }

      if (first) {
        first = false;
        this.scheduleShowBoard();
      }
      this.cdr.markForCheck();
    });

    // Use the authoritative lastSetBy$ signal to trigger the match animation.
    // This is correct for both single-player (SetGameService always emits null,
    // so animation never fires) and multiplayer (server sets lastSetBy to the
    // finder's id in the same broadcast as the board update).
    //
    // By the time this subscriber runs, state$ has already updated this.board
    // to the new board and prevBoard holds the board before the set was removed.
    // We diff them to find the three cards that were taken off the board.
    this.lastSetBySubscription = this.game.lastSetBy$.subscribe((id) => {
      if (id === null) {
        // Null is the tear-down signal emitted after LAST_SET_BANNER_MS.
        // Clear the match highlight so it doesn't persist if the animation
        // was already resolved by the state$ subscriber updating the board.
        this.setMatchIds = new Set();
        this.cdr.markForCheck();
        return;
      }

      const newBoardIds = new Set(this.board.map((c) => c.id));
      const removedCards = prevBoard.filter((c) => !newBoardIds.has(c.id));

      if (removedCards.length !== 3) return; // safety guard

      this.setMatchIds = new Set(removedCards.map((c) => c.id));
      // Temporarily restore the old board so the matched cards are visible
      // during the flash animation, then switch to the real new board.
      // Capture both snapshots now — prevBoard may be overwritten by the
      // next state$ emission before the timeout fires.
      const animOldBoard = prevBoard.slice();
      const animNewBoard = this.board.slice();
      this.board = animOldBoard;
      this.cdr.markForCheck();

      setTimeout(() => {
        this.setMatchIds = new Set();
        this.board = animNewBoard;
        this.cdr.markForCheck();
      }, SET_MATCH_DISPLAY_MS);
    });

    // Subscribe to the server-authoritative call lock so we can disable the
    // Call SET button when another player holds it (multiplayer only).
    // In single-player this stream always emits null and is effectively a no-op.
    this.callerLockSubscription = this.game.callerLockId$.subscribe((lockId) => {
      this.serverCallerLockId = lockId;
      // If the server cleared a lock that we held (timeout penalty), also
      // cancel our local countdown so the UI stays in sync.
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
      this.highlightColor = this.game.highlightColor;
    }

    this.isMultiplayer = this.game instanceof MultiplayerGameSession;
  }

  ngAfterViewInit(): void {
    // Canvas inside PaletteModalComponent is only created when the modal opens;
    // drawing is triggered via initPicker() in openPaletteModal().
  }

  ngOnDestroy(): void {
    this.stateSubscription.unsubscribe();
    this.lastSetBySubscription.unsubscribe();
    this.callerLockSubscription.unsubscribe();
    // Just clear the interval — no need to touch game state on teardown.
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
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
    // In multiplayer, reject immediately if another player already holds the lock.
    if (this.lockedByOther) return;
    // Notify the service (no-op for single-player; sends call_set WS msg for multiplayer).
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
    // In single-player: clear any partial selection by toggling selected cards.
    // In multiplayer: the server clears selections on timeout/neg via room_state
    // broadcast — sending extra select_card messages here would double-toggle.
    this.game.clearSelectionOnCancel();
    this.cdr.markForCheck();
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  @HostListener('window:resize')
  onResize(): void {
    this.updateLayout();
  }

  private updateLayout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isWide = w >= 768;

    if (isWide) {
      // ── Desktop/landscape: 4 cols, landscape cards (viewBox 180×120, ratio 3:2) ──
      this.orientation = 'landscape';
      this.gridClasses = 'grid-cols-4';
      const cols = 4;
      const rows = 3;
      const cardAspect = 180 / 120; // width / height = 1.5

      // Fit by width: boardWidth = min(w-16, 896)
      const boardWidth = Math.min(w - 16, 896);
      const cardWFromWidth = boardWidth / (cols + GAP_RATIO * (cols - 1));

      // Fit by height: allow ~56px for the toolbar row above the board
      const boardHeight = h - 56;
      const cardHFromHeight = boardHeight / (rows + GAP_RATIO * (rows - 1));
      const cardWFromHeight = cardHFromHeight * cardAspect;

      const cardWidth = Math.floor(Math.min(cardWFromWidth, cardWFromHeight));
      const gap = Math.round(GAP_RATIO * cardWidth);
      this.cardGap = gap;

      this.gridStyle = {
        gap: `${gap}px`,
        'grid-template-columns': `repeat(${cols}, ${cardWidth}px)`,
      };
    } else {
      // ── Mobile/portrait: 3 cols × 4 rows, portrait cards (viewBox 120×180, ratio 2:3) ──
      this.orientation = 'portrait';
      this.gridClasses = 'grid-cols-3';
      const cols = 3;
      const rows = 4;
      const cardAspect = 120 / 180; // width / height = 0.667

      // Fit by width
      const boardWidth = w - 16;
      const cardWFromWidth = boardWidth / (cols + GAP_RATIO * (cols - 1));

      // Fit by height: allow ~56px for the toolbar row above the board
      const boardHeight = h - 56;
      const cardHFromHeight = boardHeight / (rows + GAP_RATIO * (rows - 1));
      const cardWFromHeight = cardHFromHeight * cardAspect;

      const cardWidth = Math.floor(Math.min(cardWFromWidth, cardWFromHeight));
      const gap = Math.round(GAP_RATIO * cardWidth);
      this.cardGap = gap;

      this.gridStyle = {
        gap: `${gap}px`,
        'grid-template-columns': `repeat(${cols}, ${cardWidth}px)`,
      };
    }
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  openPaletteModal(): void {
    this.showPaletteModal = true;
    // initPicker() needs the child to be in the DOM — defer one tick.
    setTimeout(() => this.paletteModalRef?.initPicker(), 0);
  }

  closePaletteModal(): void {
    this.showPaletteModal = false;
  }

  onPaletteColorChange(event: PaletteChangeEvent): void {
    if (event.index === 3) {
      this.highlightColor = event.color;
      this.game.updateHighlightColor(event.color);
    } else {
      this.game.updatePaletteColor(event.index + 1, event.color);
      this.palette = this.game.getPalette();
    }
  }

  // ── Card helpers ──────────────────────────────────────────────────────────

  onCardClick(card: Card): void {
    // In multiplayer, only the caller can select cards.
    if (this.isMultiplayer && !this.callingSet) {
      return;
    }
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
    return override ?? this.game.getPaletteColor(c.color) ?? '#cc0000';
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private scheduleShowBoard(): void {
    setTimeout(() => {
      this.showBoard = true;
      this.cdr.markForCheck();
    }, 50);
  }
}
