import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  OnChanges,
  SimpleChanges,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { hsvToHex, hexToHsv, colorDistance } from './color.utils';

/**
 * Emitted whenever the user changes a colour in the palette modal.
 * `index` 0–2 → card palette slot; 3 → selection highlight colour.
 */
export interface PaletteChangeEvent {
  index: number;
  color: string;
}

@Component({
  selector: 'app-palette-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './palette-modal.component.html',
  styleUrls: ['./palette-modal.component.css'],
})
export class PaletteModalComponent implements OnChanges {
  /** The three card colours (palette slots 0–2). */
  @Input() palette: string[] = [];
  /** The selection highlight colour (slot 3). */
  @Input() highlightColor: string = '#000000';

  /** Emitted when the user commits a colour change. */
  @Output() colorChange = new EventEmitter<PaletteChangeEvent>();
  /** Emitted when the modal should be closed. */
  @Output() close = new EventEmitter<void>();

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

  ngOnChanges(changes: SimpleChanges): void {
    // When the modal receives new inputs (e.g. palette updated from outside),
    // keep the HSV picker in sync with the active swatch.
    if (changes['palette'] || changes['highlightColor']) {
      this.syncHsvFromColor(this.currentSwatchColor);
    }
  }

  /** The colour of whichever swatch is currently active (0–2 = palette, 3 = highlight). */
  get currentSwatchColor(): string {
    if (this.activeSwatchIdx === 3) return this.highlightColor;
    return this.palette[this.activeSwatchIdx] ?? '#cc0000';
  }

  get hasConflict(): boolean {
    const pairs: [number, number][] = [[0, 1], [1, 2], [0, 2]];
    return pairs.some(([a, b]) => colorDistance(this.palette[a], this.palette[b]) < 60);
  }

  // ── Initialise picker when first shown ───────────────────────────────────

  /** Called by the parent immediately after making the component visible. */
  initPicker(): void {
    this.activeSwatchIdx = 0;
    this.syncHsvFromColor(this.currentSwatchColor);
    // Let the canvas render before drawing.
    setTimeout(() => this.drawSvCanvas(), 0);
  }

  // ── Swatch selection ──────────────────────────────────────────────────────

  activateSwatch(idx: number): void {
    this.activeSwatchIdx = idx;
    this.hexInvalid = false;
    this.syncHsvFromColor(this.currentSwatchColor);
    this.drawSvCanvas();
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
    this.hexInvalid = false;
    this.emitColor(this.activeSwatchIdx, hsvToHex(this.hue, this.svX, this.svY));
  }

  private syncHsvFromColor(hex: string): void {
    const [h, s, v] = hexToHsv(hex || '#000000');
    this.hue = h;
    this.svX = s;
    this.svY = v;
  }

  // ── Hex input ─────────────────────────────────────────────────────────────

  onHexInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      this.hexInvalid = false;
      this.emitColor(this.activeSwatchIdx, val);
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
    this.emitColor(this.activeSwatchIdx, color);
    this.syncHsvFromColor(color);
    this.drawSvCanvas();
  }

  // ── Overlay click ─────────────────────────────────────────────────────────

  onOverlayClick(_e: MouseEvent): void {
    this.close.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emitColor(idx: number, color: string): void {
    this.colorChange.emit({ index: idx, color: color.toLowerCase() });
  }
}
