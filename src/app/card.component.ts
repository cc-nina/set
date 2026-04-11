import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Half-length (major axis) of each shape in SVG units. Increase to make shapes longer. */
const SL = 27;
/** Half-width (minor axis) of each shape in SVG units. */
const SW = 13;

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  template: `
  <svg
    preserveAspectRatio="xMidYMid meet"
    [attr.viewBox]="orientation === 'portrait' ? '0 0 120 180' : '0 0 180 120'"
    [style]="orientation === 'portrait' ? 'width:100%;aspect-ratio:120/180;display:block;' : 'width:100%;aspect-ratio:180/120;display:block;'"
    [class.card-set-match]="setMatch"
    [class.card-neg-match]="negMatch"
    role="img"
  >
      <defs>
        <!-- striped pattern (horizontal lines); id depends on color to allow multiple patterns -->
        <pattern [attr.id]="patternId" patternUnits="userSpaceOnUse" width="6" height="6">
          <rect width="6" height="6" [attr.fill]="cardBg"></rect>
          <path d="M0 3 H6" [attr.stroke]="color" stroke-width="1" />
        </pattern>
        <filter id="card-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.25" />
        </filter>
        <filter id="card-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" [attr.flood-color]="highlightColor" flood-opacity="0.7" />
        </filter>
      </defs>

  <!-- card background -->
  <rect
    [attr.x]="orientation==='portrait'?2:2" [attr.y]="orientation==='portrait'?2:2"
    [attr.width]="orientation==='portrait'?116:176" [attr.height]="orientation==='portrait'?176:116"
    rx="8" ry="8" [attr.fill]="cardBg" [attr.stroke]="cardBorder" stroke-width="1.4"
    [attr.filter]="setMatch ? 'url(#card-glow)' : 'url(#card-shadow)'"
  />

  <!-- highlight border when selected (uses highlightColor) -->
  <rect
    *ngIf="selected || setMatch || negMatch"
    [attr.x]="orientation==='portrait'?1:1" [attr.y]="orientation==='portrait'?1:1"
    [attr.width]="orientation==='portrait'?118:178" [attr.height]="orientation==='portrait'?178:118"
    rx="9" ry="9" fill="none"
    [attr.stroke]="highlightColor"
    [attr.stroke-width]="setMatch ? 4 : 3"
  />

      <!-- symbols container -->
      <g [attr.fill]="fillForShading()" [attr.stroke]="strokeForShading()" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
        <ng-container *ngFor="let i of shapePositions()">
          <g [attr.transform]="orientation === 'landscape' ? ('translate(' + i + ',60)') : ('translate(60,' + i + ')')">
            <!--
              oval: orient based on card orientation
                - landscape cards (horizontal): blobs are vertical (taller than wide)
                - portrait cards (vertical): blobs are horizontal (wider than tall)
            -->
            <ellipse *ngIf="shape === 'oval'" cx="0" cy="0"
              [attr.rx]="orientation==='portrait'?shapeSL:shapeSW"
              [attr.ry]="orientation==='portrait'?shapeSW:shapeSL" />

            <!-- diamond: half-lengths match oval major axis and minor axis -->
            <polygon *ngIf="shape === 'diamond'"
                     [attr.points]="orientation === 'portrait' ? diamondPortrait : diamondLandscape" />
          </g>
        </ng-container>
      </g>

      <!-- squiggle: rendered as a thick open stroke so ends are naturally round -->
      <ng-container *ngIf="shape === 'squiggle'">
        <ng-container *ngFor="let i of shapePositions()">
          <g [attr.transform]="orientation === 'landscape' ? ('translate(' + i + ',60)') : ('translate(60,' + i + ')')">
            <!-- border layer: slightly wider stroke in the shape colour, drawn first -->
            <path
              [attr.d]="orientation === 'portrait' ? squiggleHorizontal : squiggleVertical"
              fill="none"
              [attr.stroke]="strokeForShading()"
              [attr.stroke-width]="squiggleStrokeWidth + 4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <!-- fill layer: SW-wide stroke on top -->
            <path
              [attr.d]="orientation === 'portrait' ? squiggleHorizontal : squiggleVertical"
              fill="none"
              [attr.stroke]="shading === 'outline' ? cardBg : shading === 'striped' ? 'url(#' + patternId + ')' : strokeForShading()"
              [attr.stroke-width]="squiggleStrokeWidth"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </g>
        </ng-container>
      </ng-container>

    </svg>
  `,
  styles: [`
    /* Set-match pulse animation */
    @keyframes setMatchPulse {
      0%   { transform: scale(1);    filter: brightness(1); }
      30%  { transform: scale(1.06); filter: brightness(1.10); }
      65%  { transform: scale(0.98); filter: brightness(1.02); }
      100% { transform: scale(1);    filter: brightness(1); }
    }

    svg.card-set-match {
      animation: setMatchPulse 0.55s cubic-bezier(.22,1,.36,1) both;
      transform-origin: center;
    }

    /* Neg-match shake animation */
    @keyframes negShake {
      0%   { transform: translateX(0); }
      15%  { transform: translateX(-7px); }
      35%  { transform: translateX(6px); }
      55%  { transform: translateX(-5px); }
      72%  { transform: translateX(4px); }
      86%  { transform: translateX(-2px); }
      100% { transform: translateX(0); }
    }

    svg.card-neg-match {
      animation: negShake 0.5s cubic-bezier(.36,.07,.19,.97) both;
      transform-origin: center;
    }
  `],
  host: { style: 'display:block;width:100%;' },
})
export class CardComponent {
  @Input() color: string = '#c00';
  @Input() shape: string = 'oval';
  @Input() number: number = 1;
  @Input() orientation: 'portrait' | 'landscape' = 'portrait';
  @Input() shading: string = 'solid';
  @Input() selected: boolean = false;
  /** Colour used for the selection border ring. Defaults to black. */
  @Input() highlightColor: string = '#000000';
  /** True when this card is the 3rd card of a valid set just completed. */
  @Input() setMatch: boolean = false;
  /** True when this card was part of an incorrect 3-card selection (neg). */
  @Input() negMatch: boolean = false;
  /** Card background fill — driven by the active theme via CSS variable. */
  @Input() cardBg: string = '#ffffff';
  /** Card border stroke — driven by the active theme via CSS variable. */
  @Input() cardBorder: string = '#d1d5db';

  // pattern id for striped shading
  get patternId(): string {
    const s = (this.color || '#DB2C05').replace('#', '');
    return 'stripe-' + s;
  }

  shapePositions(): number[] {
    const n = Math.max(1, Math.min(3, Math.floor(this.number || 1)));
    // Center-to-center spacing: full shape width (2*SW) + half shape width (SW) = 3*SW
    const spacing = 3 * SW;
    if (this.orientation === 'landscape') {
      const midX = 90;
      if (n === 1) return [midX];
      if (n === 2) return [midX - spacing / 2, midX + spacing / 2];
      return [midX - spacing, midX, midX + spacing];
    } else {
      const midY = 90;
      if (n === 1) return [midY];
      if (n === 2) return [midY - spacing / 2, midY + spacing / 2];
      return [midY - spacing, midY, midY + spacing];
    }
  }

  fillForShading(): string | null {
    if (this.shading === 'solid') return this.color;
    if (this.shading === 'striped') return `url(#${this.patternId})`;
    return 'none';
  }

  strokeForShading(): string | null {
    return this.color;
  }

  /** Exposes SL to the template for oval rx/ry bindings. */
  get shapeSL(): number { return SL; }
  /** Exposes SW to the template for oval rx/ry bindings. */
  get shapeSW(): number { return SW; }

  /** Diamond points string for portrait orientation. */
  get diamondPortrait(): string {
    return `-${SL},0 0,-${SW} ${SL},0 0,${SW}`;
  }
  /** Diamond points string for landscape orientation. */
  get diamondLandscape(): string {
    return `0,-${SL} ${SW},0 0,${SL} -${SW},0`;
  }

  /**
   * Stroke width for the squiggle, sized to match the visual thickness of
   * the oval/diamond (minor axis = SW). The open-stroke approach means the
   * rendered band is stroke-width wide, so we use SW directly.
   */
  get squiggleStrokeWidth(): number { return SW; }

  /**
   * Squiggle horizontal (portrait): open S-curve centreline, ±SL in X.
   * Rendered as a thick stroke with round caps — no closed path needed.
   */
  get squiggleHorizontal(): string {
    const l = SL, w = SW;
    const t1 = +(l * 0.33).toFixed(1);
    const t2 = +(l * 0.67).toFixed(1);
    // Single S-curve: starts at left, peaks up, crosses centre, peaks down, ends at right
    return `M -${l},0 C -${t2},-${w} -${t1},-${w} 0,0 C ${t1},${w} ${t2},${w} ${l},0`;
  }

  /**
   * Squiggle vertical (landscape): open S-curve centreline, ±SL in Y.
   * Rotated 90° version of horizontal.
   */
  get squiggleVertical(): string {
    const l = SL, w = SW;
    const t1 = +(l * 0.33).toFixed(1);
    const t2 = +(l * 0.67).toFixed(1);
    return `M 0,-${l} C -${w},-${t2} -${w},-${t1} 0,0 C ${w},${t1} ${w},${t2} 0,${l}`;
  }
}