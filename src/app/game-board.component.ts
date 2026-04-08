import {
  Component,
  Inject,
  PLATFORM_ID,
  ChangeDetectorRef,
  ViewChildren,
  QueryList,
  ElementRef,
  HostListener,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardComponent } from './card.component';
import { SetGameService } from './set-game.service';

@Component({
  selector: 'app-game-board',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent],
  styles: [`
    .palette-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.35);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.15s ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .palette-modal {
      background: #fff;
      border-radius: 20px;
      padding: 28px 28px 24px;
      width: 320px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18);
      animation: slideUp 0.18s cubic-bezier(.22,1,.36,1);
      position: relative;
    }
    @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

    .modal-title {
      font-size: 16px;
      font-weight: 600;
      color: #111;
      margin-bottom: 4px;
    }
    .modal-subtitle {
      font-size: 12px;
      color: #888;
      margin-bottom: 24px;
    }

    .close-btn {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: #f0f0f0;
      color: #555;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.12s;
    }
    .close-btn:hover { background: #e0e0e0; }

    .swatch-row {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }

    .swatch-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .swatch-well {
      width: 68px;
      height: 68px;
      border-radius: 14px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.12s, border-color 0.12s;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding-bottom: 6px;
    }
    .swatch-well:hover { transform: scale(1.06); }
    .swatch-well.active { border-color: #111; }

    .swatch-edit-btn {
      display: flex;
      align-items: center;
      gap: 3px;
      background: rgba(255,255,255,0.82);
      border: none;
      border-radius: 6px;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 500;
      color: #222;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.12s;
      pointer-events: none;
      white-space: nowrap;
      position: relative;
    }
    .swatch-well:hover .swatch-edit-btn,
    .swatch-well.active .swatch-edit-btn {
      opacity: 1;
      pointer-events: auto;
    }
    .swatch-edit-btn svg { flex-shrink: 0; }

    .swatch-color-input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }

    .swatch-label {
      font-size: 11px;
      color: #888;
      letter-spacing: 0.02em;
    }

    .hex-input {
      width: 68px;
      font-size: 11px;
      text-align: center;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 5px 6px;
      background: #fafafa;
      color: #111;
      transition: border-color 0.12s;
      font-family: monospace;
    }
    .hex-input:focus {
      outline: none;
      border-color: #aaa;
      background: #fff;
    }
    .hex-input.invalid { border-color: #e24b4a; }

    .presets-section {
      margin-top: 20px;
    }
    .presets-label {
      font-size: 11px;
      color: #888;
      margin-bottom: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .presets-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .preset-dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.1s;
    }
    .preset-dot:hover { transform: scale(1.2); }
    .preset-dot.selected-preset { border-color: #111; }

    .open-palette-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 10px;
      border: 1.5px solid #e0e0e0;
      background: #fff;
      color: #333;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s, transform 0.1s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .open-palette-btn:hover {
      background: #f7f7f7;
      border-color: #ccc;
    }
    .open-palette-btn:active { transform: scale(0.97); }

    .palette-dots-preview {
      display: flex;
      gap: 4px;
    }
    .palette-dot-sm {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }

    .conflict-warning {
      margin-top: 14px;
      font-size: 11px;
      color: #b03030;
      background: #fff0f0;
      border-radius: 8px;
      padding: 6px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  `],
  template: `
    <!-- Palette Modal Overlay -->
    <div *ngIf="showPaletteModal" class="palette-modal-overlay" (click)="onOverlayClick($event)">
      <div class="palette-modal" (click)="$event.stopPropagation()">
        <button class="close-btn" (click)="closePaletteModal()" aria-label="Close">✕</button>

        <div class="modal-title">Card colours</div>
        <div class="modal-subtitle">Pick three distinct colours for the game cards</div>

        <div class="swatch-row">
          <div class="swatch-col" *ngFor="let p of palette; let idx = index">
            <div
              class="swatch-well"
              [class.active]="activeSwatchIdx === idx"
              [style.background]="p"
              (click)="activateSwatch(idx)"
            >
              <button
                class="swatch-edit-btn"
                (click)="$event.stopPropagation(); openPickerForIdx(idx)"
                [attr.aria-label]="'Edit colour ' + (idx + 1)"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 1L9 3L3.5 8.5L1 9L1.5 6.5L7 1Z" stroke="#222" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
                Edit
              </button>
              <input
                #colorInput
                class="swatch-color-input"
                type="color"
                [value]="p"
                (input)="onNativePick(idx, $event)"
              />
            </div>
            <input
              class="hex-input"
              [class.invalid]="hexInputInvalid[idx]"
              [value]="p"
              maxlength="7"
              (input)="onHexInput(idx, $event)"
              (blur)="onHexBlur(idx, $event)"
              [attr.aria-label]="'Hex colour for slot ' + (idx + 1)"
            />
            <span class="swatch-label">Colour {{idx + 1}}</span>
          </div>
        </div>

        <div *ngIf="hasConflict" class="conflict-warning">
          <span>⚠</span> Two colours are very similar — they may be hard to tell apart.
        </div>

        <div class="presets-section">
          <div class="presets-label">Quick picks</div>
          <div class="presets-grid">
            <div
              *ngFor="let pc of presetColors"
              class="preset-dot"
              [class.selected-preset]="palette[activeSwatchIdx] === pc"
              [style.background]="pc"
              [title]="pc"
              (click)="applyPreset(pc)"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main board layout -->
    <div class="flex flex-col gap-3 items-center w-full max-w-4xl mx-auto">

      <!-- Toolbar row with palette button -->
      <div class="w-full flex justify-end px-2">
        <button class="open-palette-btn" (click)="openPaletteModal()">
          <div class="palette-dots-preview">
            <div *ngFor="let p of palette" class="palette-dot-sm" [style.background]="p"></div>
          </div>
          Colours
        </button>
      </div>

      <!-- Game board -->
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
            ></app-card>
          </div>
        </div>
      </div>

    </div>
  `,
})
export class GameBoardComponent {
  board: any[] = [];
  palette: string[] = [];
  selectedIds: Set<string> = new Set();
  isBrowser = true;
  showBoard = false;
  orientation: 'portrait' | 'landscape' = 'portrait';
  gridClasses = 'grid-cols-3';

  showPaletteModal = false;
  activeSwatchIdx = 0;
  hexInputInvalid: boolean[] = [false, false, false];

  @ViewChildren('colorInput') colorInputs!: QueryList<ElementRef<HTMLInputElement>>;

  readonly presetColors: string[] = [
    '#cc0000', '#e05c00', '#d4a017',
    '#0aa64a', '#1a7fc4', '#5a2ea6',
    '#c4307a', '#16a3a3', '#2c2c2c',
  ];

  constructor(
    private game: SetGameService,
    @Inject(PLATFORM_ID) private platformId: any,
    private cdr: ChangeDetectorRef,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    let first = true;
    this.game.state$.subscribe((s) => {
      this.board = s.board;
      this.selectedIds = new Set(s.selected.map((c: any) => c.id));
      if (first) {
        first = false;
        setTimeout(() => {
          this.showBoard = true;
          try { this.cdr.detectChanges(); } catch {}
        }, 50);
      }
    });

    if (this.isBrowser) {
      this.updateLayout();
      window.addEventListener('resize', () => this.updateLayout());
      this.palette = this.game.getPalette();
    }
  }

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

  // ── Palette modal ────────────────────────────────────────────────────────────

  openPaletteModal(): void {
    this.showPaletteModal = true;
    this.activeSwatchIdx = 0;
  }

  closePaletteModal(): void {
    this.showPaletteModal = false;
  }

  onOverlayClick(event: MouseEvent): void {
    this.closePaletteModal();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showPaletteModal) this.closePaletteModal();
  }

  activateSwatch(idx: number): void {
    this.activeSwatchIdx = idx;
  }

  openPickerForIdx(idx: number): void {
    this.activeSwatchIdx = idx;
    const inputs = this.colorInputs.toArray();
    inputs[idx]?.nativeElement.click();
  }

  onNativePick(idx: number, event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    this.applyColor(idx, color);
  }

  onHexInput(idx: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      this.hexInputInvalid[idx] = false;
      this.applyColor(idx, val);
    } else {
      this.hexInputInvalid[idx] = true;
    }
  }

  onHexBlur(idx: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!/^#[0-9a-fA-F]{6}$/.test(input.value)) {
      input.value = this.palette[idx];
      this.hexInputInvalid[idx] = false;
    }
  }

  applyPreset(color: string): void {
    this.applyColor(this.activeSwatchIdx, color);
  }

  private applyColor(idx: number, color: string): void {
    const normalized = color.toLowerCase();
    this.game.updatePaletteColor(idx + 1, normalized);
    this.palette = this.game.getPalette();
    try { this.cdr.detectChanges(); } catch {}
  }

  get hasConflict(): boolean {
    const pairs: [number, number][] = [[0, 1], [1, 2], [0, 2]];
    return pairs.some(([a, b]) => this.colorDistance(this.palette[a], this.palette[b]) < 60);
  }

  private colorDistance(hex1: string, hex2: string): number {
    const parse = (h: string) => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const [r1, g1, b1] = parse(hex1);
    const [r2, g2, b2] = parse(hex2);
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  }

  // ── Card helpers ─────────────────────────────────────────────────────────────

  onCardClick(card: any): void {
    this.game.selectCard(card);
  }

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