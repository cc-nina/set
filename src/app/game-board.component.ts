import { Component, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardComponent } from './card.component';
import { SetGameService } from './set-game.service';

@Component({
  selector: 'app-game-board',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent],
  template: `
    <div class="flex flex-col gap-3 items-center w-full max-w-4xl mx-auto">
      <div class="flex gap-2 items-center">
        <label for="card-color">Card color:</label>
        <input id="card-color" type="color" [(ngModel)]="cardColor" (change)="changeCardColor(cardColor)" />
      </div>
      <div *ngIf="isBrowser && showBoard" class="board w-full flex justify-center">
        <div class="grid gap-3" [ngClass]="gridClasses">
          <div *ngFor="let c of board" (click)="onCardClick(c)" class="cursor-pointer">
            <app-card class="mx-auto" [orientation]="orientation" [color]="colorFor(c)" [shape]="shapeFor(c)" [number]="c.number" [shading]="shadingFor(c)" [selected]="selectedIds.has(c.id)"></app-card>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class GameBoardComponent {
  board: any[] = [];
  cardColor = '#cc0000';
  colorMap: Record<string, string> = {};
  selectedIds: Set<string> = new Set();
  isBrowser = true;
  showBoard = false;
  orientation: 'portrait' | 'landscape' = 'portrait';
  gridClasses = 'grid-cols-2 sm:grid-cols-4';

  constructor(private game: SetGameService, @Inject(PLATFORM_ID) private platformId: any, private cdr: ChangeDetectorRef) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    let first = true;
    this.game.state$.subscribe((s) => {
      this.board = s.board;
      this.selectedIds = new Set(s.selected.map((c: any) => c.id));
      if (first) {
        first = false;
        // small timeout to avoid transient flash when reloading
        setTimeout(() => {
          this.showBoard = true;
          // ensure change detection runs after async change to avoid ExpressionChanged errors in tests
          try {
            this.cdr.detectChanges();
          } catch (e) {
            // swallow detection errors during teardown
          }
        }, 50);
      }
    });

    if (this.isBrowser) {
      this.updateLayout();
      window.addEventListener('resize', () => this.updateLayout());
    }
  }

  private updateLayout(): void {
    const w = window.innerWidth;
    // assume laptop/desktop: landscape cards (4 columns wide, 3 rows)
    if (w >= 768) {
      this.orientation = 'landscape';
      this.gridClasses = 'grid-cols-4';
    } else {
      // mobile: portrait cards (3 columns, 4 rows layout)
      this.orientation = 'portrait';
      this.gridClasses = 'grid-cols-3';
    }
    try { this.cdr.detectChanges(); } catch {}
  }

  onCardClick(card: any): void {
    this.game.selectCard(card);
  }

  changeCardColor(newColor: string): void {
    this.cardColor = newColor;
    // apply same color to all existing cards as default; allow per-card override later
    this.board.forEach((c) => {
      this.game.updateCardColor(newColor, c.id);
      this.colorMap[c.id] = newColor;
    });
  }

  // helpers to map numeric attributes to visuals
  shapeFor(c: any): string {
    // map numeric shape attr (1..3) to 'oval'|'diamond'|'squiggle'
    const map = ['oval', 'diamond', 'squiggle'];
    return map[(c.shape || 1) - 1] || 'oval';
  }

  shadingFor(c: any): string {
    const map = ['solid', 'striped', 'outline'];
    return map[(c.shading || 1) - 1] || 'solid';
  }
  
  colorFor(c: any): string {
    // priority: service color map -> numeric mapping -> fallback to cardColor
    const svc = this.game.getCardColor(c.id);
    if (svc) return svc;
    // numeric color mapping: 1=red,2=green,3=purple
    const map = ['#cc0000', '#0aa64a', '#5a2ea6'];
    return map[(c.color || 1) - 1] || this.cardColor;
  }
}
