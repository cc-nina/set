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
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CardComponent } from './card.component';
import { PaletteModalComponent, PaletteChangeEvent } from './palette-modal.component';
import { GameSession, GAME_SESSION } from './game-session.interface';
import { Card } from './game.types';

/** How long (ms) the set-match highlight stays visible before cards are replaced. */
const SET_MATCH_DISPLAY_MS = 250;

/** Gap between cards as a fraction of card width. */
const GAP_RATIO = 0.1;

@Component({
  selector: 'app-game-board',
  standalone: true,
  imports: [CommonModule, CardComponent, PaletteModalComponent],
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

  isBrowser = true;
  showBoard = false;
  orientation: 'portrait' | 'landscape' = 'portrait';
  gridClasses = 'grid-cols-3';
  /** Inline style object for the card grid — sets gap to card-width × GAP_RATIO. */
  gridStyle: Record<string, string> = {};
  /** Current card gap in px — used to match toolbar padding to card spacing. */
  cardGap = 0;

  showPaletteModal = false;

  @ViewChild('paletteModal') paletteModalRef?: PaletteModalComponent;

  private stateSubscription!: Subscription;

  constructor(
    @Inject(GAME_SESSION) private game: GameSession,
    @Inject(PLATFORM_ID) private platformId: object,
    private cdr: ChangeDetectorRef,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);

    let first = true;
    let prevSelectedIds = new Set<string>();

    this.stateSubscription = this.game.state$.subscribe((s) => {
      const newBoard = s.board;
      const newSelectedIds = new Set(s.selected.map((c) => c.id));

      // Detect a valid set completion:
      // Previously 2 cards selected → now 0 selected (service cleared on correct set).
      if (prevSelectedIds.size === 2 && newSelectedIds.size === 0) {
        const oldBoardIds = new Set(this.board.map((c) => c.id));
        const newBoardIds = new Set(newBoard.map((c) => c.id));
        const removedIds = [...oldBoardIds].filter((id) => !newBoardIds.has(id));

        // Union of the two previously selected cards + the card that was just removed = the set
        const matchSet = new Set([...prevSelectedIds, ...removedIds]);
        if (matchSet.size === 3) {
          this.setMatchIds = matchSet;
          setTimeout(() => {
            this.setMatchIds = new Set();
            this.board = newBoard;
            this.cdr.markForCheck();
          }, SET_MATCH_DISPLAY_MS);

          // Keep old cards visible during animation; only update selection state
          this.selectedIds = newSelectedIds;
          prevSelectedIds = newSelectedIds;
          if (first) { first = false; this.scheduleShowBoard(); }
          this.cdr.markForCheck();
          return;
        }
      }

      this.board = newBoard;
      this.selectedIds = newSelectedIds;
      prevSelectedIds = newSelectedIds;

      if (first) {
        first = false;
        this.scheduleShowBoard();
      }
      this.cdr.markForCheck();
    });

    if (this.isBrowser) {
      this.updateLayout();
      this.palette = this.game.getPalette();
      this.highlightColor = this.game.highlightColor;
    }
  }

  ngAfterViewInit(): void {
    // Canvas inside PaletteModalComponent is only created when the modal opens;
    // drawing is triggered via initPicker() in openPaletteModal().
  }

  ngOnDestroy(): void {
    this.stateSubscription.unsubscribe();
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
    this.game.selectCard(card);
  }

  shapeFor(c: Card): string {
    return (['oval', 'diamond', 'squiggle'])[c.shape - 1] ?? 'oval';
  }

  shadingFor(c: Card): string {
    return (['solid', 'striped', 'outline'])[c.shading - 1] ?? 'solid';
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
