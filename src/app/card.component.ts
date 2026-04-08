import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  template: `
  <svg
    preserveAspectRatio="xMidYMid meet"
    [attr.viewBox]="orientation === 'portrait' ? '0 0 120 180' : '0 0 180 120'"
    [attr.width]="orientation === 'portrait' ? 120 : 160"
    [attr.height]="orientation === 'portrait' ? 180 : 120"
    [class.card-set-match]="setMatch"
    aria-role="img"
  >
      <defs>
        <!-- striped pattern (horizontal lines); id depends on color to allow multiple patterns -->
        <pattern [attr.id]="patternId" patternUnits="userSpaceOnUse" width="6" height="6">
          <rect width="6" height="6" fill="white"></rect>
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
    rx="8" ry="8" fill="#fff" stroke="#d1d5db" stroke-width="1.4"
    [attr.filter]="setMatch ? 'url(#card-glow)' : 'url(#card-shadow)'"
  />

  <!-- highlight border when selected (uses highlightColor) -->
  <rect
    *ngIf="selected || setMatch"
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
              [attr.rx]="orientation==='portrait'?24:10"
              [attr.ry]="orientation==='portrait'?10:24" />

            <!-- diamond: half-lengths match oval major axis (24) and minor axis (10) -->
            <polygon *ngIf="shape === 'diamond'"
                     [attr.points]="orientation === 'portrait' ? '-24,0 0,-10 24,0 0,10' : '0,-24 10,0 0,24 -10,0'" />

            <!--
              squiggle: same bounding box as oval (48×20 for portrait, 20×48 for landscape).
              The path is drawn to fill that box properly with visible width.
            -->
            <path *ngIf="shape === 'squiggle'"
              [attr.d]="orientation === 'portrait' ? squiggleHorizontal : squiggleVertical" />
          </g>
        </ng-container>
      </g>

    </svg>
  `,
  styles: [`
    /* Set-match pulse animation */
    @keyframes setMatchPulse {
      0%   { transform: scale(1);    filter: brightness(1); }
      30%  { transform: scale(1.08); filter: brightness(1.12); }
      60%  { transform: scale(0.97); filter: brightness(1.05); }
      100% { transform: scale(1);    filter: brightness(1); }
    }

    svg.card-set-match {
      animation: setMatchPulse 0.55s cubic-bezier(.22,1,.36,1) both;
      transform-origin: center;
    }
  `],
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

  // pattern id for striped shading
  get patternId(): string {
    const s = (this.color || '#cc0000').replace('#', '');
    return 'stripe-' + s;
  }

  shapePositions(): number[] {
    const n = Math.max(1, Math.min(3, Math.floor(this.number || 1)));
    if (this.orientation === 'landscape') {
      const midX = 90;
      if (n === 1) return [midX];
      if (n === 2) return [midX - 20, midX + 20];
      return [midX - 30, midX, midX + 30];
    } else {
      const midY = 90;
      if (n === 1) return [midY];
      if (n === 2) return [midY - 20, midY + 20];
      return [midY - 30, midY, midY + 30];
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

  /**
   * Squiggle horizontal (portrait card): spans ±24 in X, ±10 in Y.
   * Uses a closed S-curve with enough thickness to look like the other shapes.
   */
  get squiggleHorizontal(): string {
    return [
      'M -24,-4',
      'C -16,-10  -8,-10   0,-4',
      'C  8,  2  16,  2  24,-4',
      'L  24, 4',
      'C  16, 10   8, 10   0, 4',
      'C  -8, -2 -16, -2 -24, 4',
      'Z',
    ].join(' ');
  }

  /**
   * Squiggle vertical (landscape card): spans ±10 in X, ±24 in Y.
   * Rotated version of the horizontal squiggle.
   */
  get squiggleVertical(): string {
    return [
      'M -4,-24',
      'C -10,-16 -10, -8  -4,  0',
      'C   2,  8   2, 16  -4, 24',
      'L   4, 24',
      'C  10, 16  10,  8   4,  0',
      'C  -2, -8  -2,-16   4,-24',
      'Z',
    ].join(' ');
  }
}