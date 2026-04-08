import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  template: `
  <svg preserveAspectRatio="xMidYMid meet" [attr.viewBox]="orientation === 'portrait' ? '0 0 120 180' : '0 0 180 120'" [attr.width]="orientation === 'portrait' ? 120 : 160" [attr.height]="orientation === 'portrait' ? 180 : 120" aria-role="img">
      <defs>
        <!-- striped pattern (horizontal lines); id depends on color to allow multiple patterns -->
        <pattern [attr.id]="patternId" patternUnits="userSpaceOnUse" width="6" height="6">
          <rect width="6" height="6" fill="white"></rect>
          <path d="M0 3 H6" [attr.stroke]="color" stroke-width="1" />
        </pattern>
        <filter id="card-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.25" />
        </filter>
      </defs>

  <!-- card background -->
  <rect [attr.x]="orientation==='portrait'?2:2" [attr.y]="orientation==='portrait'?2:2"
    [attr.width]="orientation==='portrait'?116:176" [attr.height]="orientation==='portrait'?176:116"
    rx="8" ry="8" fill="#fff" stroke="#ccc" [attr.filter]="selected ? 'url(#card-shadow)' : null" />

  <!-- highlight border when selected -->
  <rect *ngIf="selected" [attr.x]="orientation==='portrait'?1:1" [attr.y]="orientation==='portrait'?1:1"
    [attr.width]="orientation==='portrait'?118:178" [attr.height]="orientation==='portrait'?178:118"
    rx="9" ry="9" fill="none" [attr.stroke]="color" stroke-width="3" />

      <!-- symbols container -->
      <g [attr.fill]="fillForShading()" [attr.stroke]="strokeForShading()" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
        <ng-container *ngFor="let i of shapePositions()">
          <g [attr.transform]="orientation === 'landscape' ? ('translate(' + i + ',60)') : ('translate(60,' + i + ')')">
            <!-- oval: make orientation depend on card orientation
                 - landscape cards (horizontal): blobs should be vertical (taller than wide)
                 - portrait cards (vertical): blobs should be horizontal (wider than tall)
            -->
            <ellipse *ngIf="shape === 'oval'" cx="0" cy="0" [attr.rx]="orientation==='portrait'?24:10" [attr.ry]="orientation==='portrait'?10:24" />

            <!-- diamond: make length match oval major axis (half-length 24) and orient per card -->
            <polygon *ngIf="shape === 'diamond'"
                     [attr.points]="orientation === 'portrait' ? '-24,0 0,-10 24,0 0,10' : '0,-24 10,0 0,24 -10,0'" />

            <!-- squiggle (simplified). Provide two variants so the long axis matches ovals (48px total length) -->
            <path *ngIf="shape === 'squiggle'" [attr.d]="orientation === 'portrait' ? squiggleHorizontal : squiggleVertical" />
          </g>
        </ng-container>
      </g>

    </svg>
  `,
  styles: [],
})
export class CardComponent {
  @Input() color: string = '#c00';
  @Input() shape: string = 'oval';
  @Input() number: number = 1;
  @Input() orientation: 'portrait' | 'landscape' = 'portrait';
  @Input() shading: string = 'solid';
  @Input() selected: boolean = false;

  // pattern id for striped shading
  get patternId(): string {
    // sanitize color hex (remove #)
    const s = (this.color || '#cc0000').replace('#', '');
    return 'stripe-' + s;
  }

  shapePositions(): number[] {
    // return positions for 1..3 symbols depending on orientation.
    // For landscape (horizontal) cards: return x positions centered on midX = 90.
    // For portrait (vertical) cards: return y positions centered on midY = 90.
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
    // outline
    return 'none';
  }

  strokeForShading(): string | null {
    if (this.shading === 'outline') return this.color;
    // for solid/striped, also stroke in same color for better visibility
    return this.color;
  }

  // squiggle paths sized to match oval major axis (~48px length)
  get squiggleHorizontal(): string {
    // horizontal squiggle: wider than tall (for portrait cards)
    return 'M -24 0 C -18 -12, -6 -12, 0 0 C 6 12, 18 12, 24 0 C 18 6, 6 6, 0 0 C -6 -6, -18 -6, -24 0 Z';
  }

  get squiggleVertical(): string {
    // vertical squiggle: taller than wide (for landscape cards)
    return 'M 0 -24 C -12 -18, -12 -6, 0 0 C 12 6, 12 18, 0 24 C -6 18, -6 6, 0 0 C 6 -6, 6 -18, 0 -24 Z';
  }
}
