import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  HostListener,
  NgZone,
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
export class PaletteModalComponent implements OnChanges, OnDestroy {
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
  /** Drives the hex input value — kept in sync with the picker so it updates while dragging. */
  hexInputValue = '';

  // HSV picker state
  hue = 0;   // 0–360
  svX = 1;   // saturation 0–1
  svY = 1;   // value 0–1

  @ViewChild('svCanvas') svCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('modal') modalRef!: ElementRef<HTMLElement>;

  private previouslyFocused: HTMLElement | null = null;

  constructor(private ngZone: NgZone) {}

  readonly presetColors: string[] = [
    '#DB2C05', '#e05c00', '#d4a017', '#0C8D1B', 
    '#1872d8', '#d45695', '#4F158A', '#5a5a5a',
  ];

  /** Colourblind-friendly preset set. */
  readonly colorblindColors: [string, string, string] = ['#ff2600', '#00f900', '#0433ff'];

  readonly defaultPalette: [string, string, string] = ['#db2c05', '#0c8d1b', '#4F158A'];
  readonly defaultHighlight: string = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['palette'] || changes['highlightColor']) {
      this.syncHsvFromColor(this.currentSwatchColor);
      setTimeout(() => this.drawSvCanvas(), 0);
    }
  }

  /** The colour of whichever swatch is currently active (0–2 = palette, 3 = highlight). */
  get currentSwatchColor(): string {
    if (this.activeSwatchIdx === 3) return this.highlightColor;
    return this.palette[this.activeSwatchIdx] ?? '#DB2C05';
  }

  get hasConflict(): boolean {
    const pairs: [number, number][] = [[0, 1], [1, 2], [0, 2]];
    return pairs.some(([a, b]) => colorDistance(this.palette[a], this.palette[b]) < 60);
  }

  // ── Initialise picker when first shown ───────────────────────────────────

  /** Called by the parent immediately after making the component visible. */
  initPicker(): void {
    this.previouslyFocused = document.activeElement as HTMLElement;
    this.activeSwatchIdx = 0;
    this.syncHsvFromColor(this.currentSwatchColor);
    setTimeout(() => {
      this.drawSvCanvas();
      this.modalRef?.nativeElement.querySelector<HTMLElement>('button')?.focus();
    }, 0);
  }

  ngOnDestroy(): void {
    this.previouslyFocused?.focus();
  }

  // ── Swatch selection ──────────────────────────────────────────────────────

  activateSwatch(idx: number): void {
    this.activeSwatchIdx = idx;
    this.hexInvalid = false;
    this.syncHsvFromColor(this.currentSwatchColor);
    setTimeout(() => this.drawSvCanvas(), 0);
  }

  // ── Canvas drawing ────────────────────────────────────────────────────────

  private drawSvCanvas(): void {
    const canvas = this.svCanvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.offsetWidth  || 264;
    const H = canvas.offsetHeight || 180;
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
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    this.ngZone.run(() => this.handleSvEvent(el, e.clientX, e.clientY));
    const move = (me: MouseEvent) =>
      this.ngZone.run(() => this.handleSvEvent(el, me.clientX, me.clientY));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  onSvTouch(e: TouchEvent): void {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const t = e.touches[0];
    this.ngZone.run(() => this.handleSvEvent(el, t.clientX, t.clientY));
    const move = (te: TouchEvent) => {
      const tt = te.touches[0];
      this.ngZone.run(() => this.handleSvEvent(el, tt.clientX, tt.clientY));
    };
    const up = () => {
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('touchend', up);
    });
  }

  private handleSvEvent(el: HTMLElement, clientX: number, clientY: number): void {
    const rect = el.getBoundingClientRect();
    this.svX = Math.max(0, Math.min(1, (clientX - rect.left)  / rect.width));
    this.svY = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    this.commitHsv();
  }

  // ── Hue slider interactions ───────────────────────────────────────────────

  onHueMouseDown(e: MouseEvent): void {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    this.ngZone.run(() => this.handleHueEvent(el, e.clientX));
    const move = (me: MouseEvent) =>
      this.ngZone.run(() => this.handleHueEvent(el, me.clientX));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  onHueTouch(e: TouchEvent): void {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const t = e.touches[0];
    this.ngZone.run(() => this.handleHueEvent(el, t.clientX));
    const move = (te: TouchEvent) => {
      const tt = te.touches[0];
      this.ngZone.run(() => this.handleHueEvent(el, tt.clientX));
    };
    const up = () => {
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('touchend', up);
    });
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
    const color = hsvToHex(this.hue, this.svX, this.svY);
    this.hexInputValue = color;
    this.emitColor(this.activeSwatchIdx, color);
  }

  private syncHsvFromColor(hex: string): void {
    const [h, s, v] = hexToHsv(hex || '#000000');
    this.hue = h;
    this.svX = s;
    this.svY = v;
    this.hexInputValue = hex.toLowerCase();
  }

  // ── Hex input ─────────────────────────────────────────────────────────────

  onHexInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.hexInputValue = val;
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
      this.hexInputValue = this.currentSwatchColor;
      this.hexInvalid = false;
    }
  }

  // ── Presets ───────────────────────────────────────────────────────────────

  applyPreset(color: string): void {
    this.emitColor(this.activeSwatchIdx, color);
    this.syncHsvFromColor(color);
    this.drawSvCanvas();
  }

  /** Apply the three colourblind-friendly colours to all three card slots
   *  and reset the selection highlight to the default black. */
  applyColorblindSet(): void {
    this.colorblindColors.forEach((c, i) => this.emitColor(i, c));
    this.emitColor(3, this.defaultHighlight);
    this.activateSwatch(0);
  }

  /** Reset all four slots back to the application defaults. */
  resetToDefaults(): void {
    this.defaultPalette.forEach((c, i) => this.emitColor(i, c));
    this.emitColor(3, this.defaultHighlight);
    this.activateSwatch(0);
  }

  // ── Overlay click ─────────────────────────────────────────────────────────

  onOverlayClick(_e: MouseEvent): void {
    this.close.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close.emit();
      return;
    }
    if (event.key !== 'Tab') return;

    const modal = this.modalRef?.nativeElement;
    if (!modal) return;

    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !modal.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !modal.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emitColor(idx: number, color: string): void {
    this.colorChange.emit({ index: idx, color: color.toLowerCase() });
  }
}
