import {
  Component,
  Inject,
  PLATFORM_ID,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
  HostListener,
  AfterViewInit,
  NgZone,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardComponent } from './card.component';
import { SetGameService } from './set-game.service';

/** How long (ms) the set-match highlight stays visible before cards are replaced. */
const SET_MATCH_DISPLAY_MS = 700;

@Component({
  selector: 'app-game-board',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent],
  styles: [`
    /* ── Overlay & modal ───────────────────────────────────────────── */
    .palette-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.35);
      z-index: 100;
      display: flex; align-items: center; justify-content: center;
      animation: fadeIn 0.15s ease;
    }
    @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }

    .palette-modal {
      background: #fff;
      border-radius: 20px;
      padding: 28px 28px 24px;
      width: 320px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18);
      animation: slideUp 0.18s cubic-bezier(.22,1,.36,1);
      position: relative;
    }
    @keyframes slideUp {
      from { opacity:0; transform:translateY(16px) }
      to   { opacity:1; transform:translateY(0) }
    }

    .modal-title    { font-size:16px; font-weight:600; color:#111; margin-bottom:4px; }
    .modal-subtitle { font-size:12px; color:#888; margin-bottom:24px; }

    .close-btn {
      position:absolute; top:16px; right:16px;
      width:28px; height:28px; border-radius:50%;
      border:none; background:#f0f0f0; color:#555;
      font-size:16px; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:background 0.12s;
    }
    .close-btn:hover { background:#e0e0e0; }

    /* ── Swatch rows ────────────────────────────────────────────────── */
    .swatch-row { display:flex; gap:12px; align-items:flex-start; }
    .swatch-col { display:flex; flex-direction:column; align-items:center; gap:8px; flex:1; }

    .swatch-well {
      width:56px; height:56px; border-radius:14px;
      border:2px solid transparent;
      cursor:pointer;
      transition:transform 0.12s, border-color 0.12s;
    }
    .swatch-well:hover { transform:scale(1.06); }
    .swatch-well.active { border-color:#111; }

    /* The highlight swatch gets a special ring so black-on-white is still visible */
    .swatch-well.highlight-swatch {
      box-shadow: inset 0 0 0 1.5px #ccc;
    }

    .swatch-label { font-size:10px; color:#888; text-align:center; }

    /* Divider between card colours and highlight colour */
    .swatch-divider {
      width:1px; background:#e8e8e8; align-self:stretch; margin: 0 2px;
    }

    /* ── Custom colour picker panel ────────────────────────────────── */
    .picker-panel {
      margin-top:20px;
      display:flex; flex-direction:column; gap:12px;
    }

    /* SV (saturation/value) canvas */
    .sv-canvas-wrap {
      position:relative; width:100%; height:160px;
      border-radius:10px; overflow:hidden; cursor:crosshair;
      user-select:none;
    }
    #sv-canvas { display:block; width:100%; height:100%; }
    .sv-cursor {
      position:absolute;
      width:14px; height:14px; border-radius:50%;
      border:2.5px solid #fff;
      box-shadow:0 0 0 1.5px rgba(0,0,0,0.35);
      transform:translate(-50%,-50%);
      pointer-events:none;
    }

    /* Hue slider */
    .hue-wrap { position:relative; height:14px; border-radius:7px; cursor:pointer; user-select:none; }
    .hue-track {
      width:100%; height:100%; border-radius:7px;
      background:linear-gradient(to right,
        #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);
    }
    .hue-thumb {
      position:absolute; top:50%;
      width:18px; height:18px; border-radius:50%;
      border:2.5px solid #fff;
      box-shadow:0 0 0 1.5px rgba(0,0,0,0.3);
      transform:translate(-50%,-50%);
      pointer-events:none;
    }

    /* Hex input + current swatch */
    .hex-row {
      display:flex; align-items:center; gap:10px;
    }
    .hex-preview {
      width:32px; height:32px; border-radius:8px; flex-shrink:0;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
    }
    .hex-input {
      flex:1; font-size:12px; font-family:monospace;
      text-align:center;
      border:1px solid #e0e0e0; border-radius:8px;
      padding:6px 8px; background:#fafafa; color:#111;
      transition:border-color 0.12s;
    }
    .hex-input:focus { outline:none; border-color:#aaa; background:#fff; }
    .hex-input.invalid { border-color:#e24b4a; }

    /* ── Presets ────────────────────────────────────────────────────── */
    .presets-section { margin-top:4px; }
    .presets-label {
      font-size:11px; color:#888; margin-bottom:10px;
      letter-spacing:0.04em; text-transform:uppercase;
    }
    .presets-grid { display:flex; flex-wrap:wrap; gap:8px; }
    .preset-dot {
      width:24px; height:24px; border-radius:50%;
      border:2px solid transparent;
      cursor:pointer; transition:transform 0.1s;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.10);
    }
    .preset-dot:hover { transform:scale(1.2); }
    .preset-dot.selected-preset { border-color:#111; }

    /* ── Conflict warning ───────────────────────────────────────────── */
    .conflict-warning {
      font-size:11px; color:#b03030; background:#fff0f0;
      border-radius:8px; padding:6px 10px;
      display:flex; align-items:center; gap:6px;
    }

    /* ── Open button ────────────────────────────────────────────────── */
    .open-palette-btn {
      display:inline-flex; align-items:center; gap:8px;
      padding:8px 14px; border-radius:10px;
      border:1.5px solid #e0e0e0; background:#fff; color:#333;
      font-size:13px; font-weight:500; cursor:pointer;
      transition:background 0.12s, border-color 0.12s, transform 0.1s;
      box-shadow:0 1px 3px rgba(0,0,0,0.06);
    }
    .open-palette-btn:hover { background:#f7f7f7; border-color:#ccc; }
    .open-palette-btn:active { transform:scale(0.97); }

    .palette-dots-preview { display:flex; gap:4px; align-items:center; }
    .palette-dot-sm { width:12px; height:12px; border-radius:50%; }
    /* Small preview of highlight colour — shown as a ring */
    .palette-highlight-sm {
      width:12px; height:12px; border-radius:50%;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
      border: 2.5px solid;
      background: transparent;
    }
  `],
  template: `
    <!-- ── Palette modal ──────────────────────────────────────────────── -->
    <div *ngIf="showPaletteModal" class="palette-modal-overlay" (click)="onOverlayClick($event)">
      <div class="palette-modal" (click)="$event.stopPropagation()">
        <button class="close-btn" (click)="closePaletteModal()" aria-label="Close">✕</button>

        <div class="modal-title">Card colours</div>
        <div class="modal-subtitle">Pick three card colours and a selection highlight</div>

        <!-- Swatch row: 3 card colours | divider | 1 highlight colour -->
        <div class="swatch-row">
          <ng-container *ngFor="let p of palette; let idx = index">
            <div class="swatch-col">
              <div
                class="swatch-well"
                [class.active]="activeSwatchIdx === idx"
                [style.background]="p"
                (click)="activateSwatch(idx)"
              ></div>
              <span class="swatch-label">Colour {{idx + 1}}</span>
            </div>
          </ng-container>

          <!-- Divider -->
          <div class="swatch-divider"></div>

          <!-- Highlight colour (index 3 in our all-swatches array) -->
          <div class="swatch-col">
            <div
              class="swatch-well highlight-swatch"
              [class.active]="activeSwatchIdx === 3"
              [style.background]="highlightColor"
              (click)="activateSwatch(3)"
            ></div>
            <span class="swatch-label">Selection</span>
          </div>
        </div>

        <!-- Custom picker -->
        <div class="picker-panel">

          <!-- SV canvas -->
          <div class="sv-canvas-wrap"
               (mousedown)="onSvMouseDown($event)"
               (touchstart)="onSvTouch($event)">
            <canvas #svCanvas id="sv-canvas"></canvas>
            <div class="sv-cursor" [style.left.%]="svX * 100" [style.top.%]="(1 - svY) * 100"></div>
          </div>

          <!-- Hue slider -->
          <div class="hue-wrap"
               (mousedown)="onHueMouseDown($event)"
               (touchstart)="onHueTouch($event)">
            <div class="hue-track"></div>
            <div class="hue-thumb" [style.left.%]="hue / 360 * 100"></div>
          </div>

          <!-- Hex row -->
          <div class="hex-row">
            <div class="hex-preview" [style.background]="currentSwatchColor"></div>
            <input
              class="hex-input"
              [class.invalid]="hexInvalid"
              [value]="currentSwatchColor"
              maxlength="7"
              (input)="onHexInput($event)"
              (blur)="onHexBlur($event)"
              aria-label="Hex colour"
            />
          </div>
        </div>

        <div *ngIf="hasConflict" class="conflict-warning" style="margin-top:12px;">
          <span>⚠</span> Two colours are very similar — they may be hard to tell apart.
        </div>

        <!-- Presets -->
        <div class="presets-section" style="margin-top:16px;">
          <div class="presets-label">Quick picks</div>
          <div class="presets-grid">
            <div
              *ngFor="let pc of presetColors"
              class="preset-dot"
              [class.selected-preset]="currentSwatchColor === pc"
              [style.background]="pc"
              [title]="pc"
              (click)="applyPreset(pc)"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Main board ──────────────────────────────────────────────────── -->
    <div class="flex flex-col gap-3 items-center w-full max-w-4xl mx-auto">

      <div class="w-full flex justify-end px-2">
        <button class="open-palette-btn" (click)="openPaletteModal()">
          <div class="palette-dots-preview">
            <div *ngFor="let p of palette" class="palette-dot-sm" [style.background]="p"></div>
            <!-- Highlight preview as a ring -->
            <div class="palette-highlight-sm" [style.border-color]="highlightColor"></div>
          </div>
          Colours
        </button>
      </div>

      <div *ngIf="isBrowser && showBoard" class="board w-full flex justify-center">
        <div class="grid gap-3" [ngClass]="gridClasses">
          <div *ngFor="let c of board" (click)="onCardClick(c)" class="cursor-pointer">
            <app-card
              class="mx-auto"
              [orientation]="orientation"
              [color]="colorFor(c)"
              [shape]="shapeFor(c)"
              [number]="c.number"
              [shading]="shadingFor(c)"
              [selected]="selectedIds.has(c.id)"
              [setMatch]="setMatchIds.has(c.id)"
              [highlightColor]="highlightColor"
            ></app-card>
          </div>
        </div>
      </div>

    </div>
  `,
})
export class GameBoardComponent implements AfterViewInit {
  board: any[] = [];
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

  showPaletteModal = false;
  /**
   * 0–2 → card palette slots; 3 → highlight colour.
   */
  activeSwatchIdx = 0;
  hexInvalid = false;

  // HSV picker state
  hue = 0;   // 0–360
  svX = 1;   // saturation 0–1
  svY = 1;   // value 0–1

  @ViewChild('svCanvas') svCanvasRef!: ElementRef<HTMLCanvasElement>;

  readonly presetColors: string[] = [
    '#cc0000', '#e05c00', '#d4a017',
    '#0aa64a', '#1a7fc4', '#5a2ea6',
    '#c4307a', '#16a3a3', '#2c2c2c',
    '#000000', '#ffffff', '#808080',
  ];

  constructor(
    private game: SetGameService,
    @Inject(PLATFORM_ID) private platformId: any,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    let first = true;
    let prevSelectedIds = new Set<string>();

    this.game.state$.subscribe((s) => {
      const newBoard = s.board;
      const newSelectedIds = new Set(s.selected.map((c: any) => c.id));

      // Detect a valid set completion:
      // Previously 2 cards selected → now 0 selected AND board changed (cards replaced).
      // We capture the IDs that *were* selected and check if they formed a set.
      if (prevSelectedIds.size === 2 && newSelectedIds.size === 0) {
        // The 3rd card that completed the set isn't in newSelectedIds (already cleared),
        // but we can detect it by seeing which selected IDs from state are now gone
        // because game.service clears selection on a correct set.
        // We get the last confirmed selected IDs from the board subscription:
        // Compare the old board to the new board to find removed cards.
        const oldBoardIds = new Set(this.board.map((c: any) => c.id));
        const newBoardIds = new Set(newBoard.map((c: any) => c.id));
        const removedIds = [...oldBoardIds].filter(id => !newBoardIds.has(id));

        // Union: cards that were selected + any removed cards = the set
        const matchSet = new Set([...prevSelectedIds, ...removedIds]);
        if (matchSet.size === 3) {
          this.setMatchIds = matchSet;
          setTimeout(() => {
            this.setMatchIds = new Set();
            this.board = newBoard;
            try { this.cdr.detectChanges(); } catch {}
          }, SET_MATCH_DISPLAY_MS);

          // Don't update board yet — keep old cards visible during animation
          this.selectedIds = newSelectedIds;
          prevSelectedIds = newSelectedIds;
          if (first) { first = false; this._showBoard(); }
          try { this.cdr.detectChanges(); } catch {}
          return;
        }
      }

      this.board = newBoard;
      this.selectedIds = newSelectedIds;
      prevSelectedIds = newSelectedIds;

      if (first) {
        first = false;
        this._showBoard();
      }
      try { this.cdr.detectChanges(); } catch {}
    });

    if (this.isBrowser) {
      this.updateLayout();
      window.addEventListener('resize', () => this.updateLayout());
      this.palette = this.game.getPalette();
    }
  }

  private _showBoard(): void {
    setTimeout(() => {
      this.showBoard = true;
      try { this.cdr.detectChanges(); } catch {}
    }, 50);
  }

  ngAfterViewInit(): void {
    // Canvas is only in the DOM once the modal opens; drawing triggered there.
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  private updateLayout(): void {
    const w = window.innerWidth;
    if (w >= 768) {
      this.orientation = 'landscape';
      this.gridClasses = 'grid-cols-4';
    } else {
      this.orientation = 'portrait';
      this.gridClasses = 'grid-cols-3';
    }
    try { this.cdr.detectChanges(); } catch {}
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  openPaletteModal(): void {
    this.showPaletteModal = true;
    this.activeSwatchIdx = 0;
    this.syncHsvFromColor(this.palette[0]);
    setTimeout(() => this.drawSvCanvas(), 0);
  }

  closePaletteModal(): void {
    this.showPaletteModal = false;
  }

  onOverlayClick(_e: MouseEvent): void { this.closePaletteModal(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.showPaletteModal) this.closePaletteModal(); }

  // ── Swatch selection ──────────────────────────────────────────────────────

  activateSwatch(idx: number): void {
    this.activeSwatchIdx = idx;
    this.hexInvalid = false;
    this.syncHsvFromColor(this.currentSwatchColor);
    this.drawSvCanvas();
    try { this.cdr.detectChanges(); } catch {}
  }

  /** The colour of whichever swatch is currently active (0-2 = palette, 3 = highlight). */
  get currentSwatchColor(): string {
    if (this.activeSwatchIdx === 3) return this.highlightColor;
    return this.palette[this.activeSwatchIdx] || '#cc0000';
  }

  // ── Canvas drawing ────────────────────────────────────────────────────────

  private drawSvCanvas(): void {
    const canvas = this.svCanvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.offsetWidth  || 264;
    const H = canvas.offsetHeight || 160;
    canvas.width  = W;
    canvas.height = H;

    const gH = ctx.createLinearGradient(0, 0, W, 0);
    gH.addColorStop(0, '#fff');
    gH.addColorStop(1, `hsl(${this.hue},100%,50%)`);
    ctx.fillStyle = gH;
    ctx.fillRect(0, 0, W, H);

    const gV = ctx.createLinearGradient(0, 0, 0, H);
    gV.addColorStop(0, 'rgba(0,0,0,0)');
    gV.addColorStop(1, '#000');
    ctx.fillStyle = gV;
    ctx.fillRect(0, 0, W, H);
  }

  // ── SV canvas interactions ────────────────────────────────────────────────

  onSvMouseDown(e: MouseEvent): void {
    this.handleSvEvent(e.currentTarget as HTMLElement, e.clientX, e.clientY);
    const move = (me: MouseEvent) =>
      this.handleSvEvent(e.currentTarget as HTMLElement, me.clientX, me.clientY);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  onSvTouch(e: TouchEvent): void {
    e.preventDefault();
    const t = e.touches[0];
    this.handleSvEvent(e.currentTarget as HTMLElement, t.clientX, t.clientY);
    const move = (te: TouchEvent) => {
      const tt = te.touches[0];
      this.handleSvEvent(e.currentTarget as HTMLElement, tt.clientX, tt.clientY);
    };
    const up = () => {
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  }

  private handleSvEvent(el: HTMLElement, clientX: number, clientY: number): void {
    const rect = el.getBoundingClientRect();
    this.svX = Math.max(0, Math.min(1, (clientX - rect.left)  / rect.width));
    this.svY = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    this.commitHsv();
  }

  // ── Hue slider interactions ───────────────────────────────────────────────

  onHueMouseDown(e: MouseEvent): void {
    this.handleHueEvent(e.currentTarget as HTMLElement, e.clientX);
    const move = (me: MouseEvent) =>
      this.handleHueEvent(e.currentTarget as HTMLElement, me.clientX);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  onHueTouch(e: TouchEvent): void {
    e.preventDefault();
    const t = e.touches[0];
    this.handleHueEvent(e.currentTarget as HTMLElement, t.clientX);
    const move = (te: TouchEvent) => {
      const tt = te.touches[0];
      this.handleHueEvent(e.currentTarget as HTMLElement, tt.clientX);
    };
    const up = () => {
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  }

  private handleHueEvent(el: HTMLElement, clientX: number): void {
    const rect = el.getBoundingClientRect();
    this.hue = Math.max(0, Math.min(360, ((clientX - rect.left) / rect.width) * 360));
    this.drawSvCanvas();
    this.commitHsv();
  }

  // ── HSV ↔ hex ─────────────────────────────────────────────────────────────

  private commitHsv(): void {
    const hex = this.hsvToHex(this.hue, this.svX, this.svY);
    this.hexInvalid = false;
    this.applyColor(this.activeSwatchIdx, hex);
  }

  private syncHsvFromColor(hex: string): void {
    const [h, s, v] = this.hexToHsv(hex || '#000000');
    this.hue = h;
    this.svX = s;
    this.svY = v;
  }

  private hsvToHex(h: number, s: number, v: number): string {
    const f = (n: number) => {
      const k = (n + h / 60) % 6;
      const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
      return Math.round(val * 255).toString(16).padStart(2, '0');
    };
    return `#${f(5)}${f(3)}${f(1)}`;
  }

  private hexToHsv(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r)      h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r)  / d + 2;
      else                h = (r - g)  / d + 4;
      h *= 60;
    }
    return [h, max ? d / max : 0, max];
  }

  // ── Hex input ─────────────────────────────────────────────────────────────

  onHexInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      this.hexInvalid = false;
      this.applyColor(this.activeSwatchIdx, val);
      this.syncHsvFromColor(val);
      this.drawSvCanvas();
    } else {
      this.hexInvalid = true;
    }
  }

  onHexBlur(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!/^#[0-9a-fA-F]{6}$/.test(input.value)) {
      input.value = this.currentSwatchColor;
      this.hexInvalid = false;
    }
  }

  // ── Presets ───────────────────────────────────────────────────────────────

  applyPreset(color: string): void {
    this.applyColor(this.activeSwatchIdx, color);
    this.syncHsvFromColor(color);
    this.drawSvCanvas();
  }

  // ── Core colour apply ─────────────────────────────────────────────────────

  /**
   * Apply a colour to a swatch slot.
   * Slots 0–2 → card palette; slot 3 → selection highlight.
   */
  private applyColor(idx: number, color: string): void {
    if (idx === 3) {
      this.highlightColor = color.toLowerCase();
    } else {
      this.game.updatePaletteColor(idx + 1, color.toLowerCase());
      this.palette = this.game.getPalette();
    }
    try { this.cdr.detectChanges(); } catch {}
  }

  // ── Conflict ──────────────────────────────────────────────────────────────

  get hasConflict(): boolean {
    const pairs: [number, number][] = [[0, 1], [1, 2], [0, 2]];
    return pairs.some(([a, b]) => this.colorDistance(this.palette[a], this.palette[b]) < 60);
  }

  private colorDistance(h1: string, h2: string): number {
    const p = (h: string) => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const [r1, g1, b1] = p(h1), [r2, g2, b2] = p(h2);
    return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
  }

  // ── Card helpers ──────────────────────────────────────────────────────────

  onCardClick(card: any): void { this.game.selectCard(card); }

  shapeFor(c: any): string {
    return (['oval', 'diamond', 'squiggle'])[(c.shape || 1) - 1] || 'oval';
  }

  shadingFor(c: any): string {
    return (['solid', 'striped', 'outline'])[(c.shading || 1) - 1] || 'solid';
  }

  colorFor(c: any): string {
    const svc = this.game.getCardColor(c.id);
    if (svc) return svc;
    return this.game.getPaletteColor(c.color || 1) || '#cc0000';
  }
}