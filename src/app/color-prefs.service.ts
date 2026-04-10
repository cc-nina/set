import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { loadColorPrefs, saveColorPrefs } from './color-prefs.storage';

const DEFAULT_PALETTE: [string, string, string] = ['#cc0000', '#0aa64a', '#5a2ea6'];
const DEFAULT_HIGHLIGHT = '#000000';

/**
 * Shared service that owns colour preferences for a game session.
 * Both SetGameService and MultiplayerGameSession delegate all palette /
 * highlight / per-card colour logic here, keeping that concern in one place.
 *
 * Provided at the root level so it persists across route changes and is
 * available as a DI dependency of the two game-session services.
 */
@Injectable({ providedIn: 'root' })
export class ColorPrefsService {
  // Palette for numeric colour attribute (index 1..3). Always exactly 3 entries.
  private palette: [string, string, string];

  /** Persisted highlight colour — loaded at boot, kept in sync via updateHighlightColor(). */
  highlightColor: string;

  /** Per-card colour overrides (cardId → hex). Reset on new game via clearCardColors(). */
  private cardColors: Record<string, string> = {};

  constructor(@Inject(PLATFORM_ID) private platformId: object) {
    const saved = isPlatformBrowser(this.platformId) ? loadColorPrefs() : null;
    this.palette     = saved ? ([...saved.palette] as [string, string, string]) : ([...DEFAULT_PALETTE] as [string, string, string]);
    this.highlightColor = saved?.highlightColor ?? DEFAULT_HIGHLIGHT;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private save(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    saveColorPrefs({
      palette: [...this.palette] as [string, string, string],
      highlightColor: this.highlightColor,
    });
  }

  // ── Palette API ───────────────────────────────────────────────────────────

  getPalette(): string[] {
    return this.palette.slice();
  }

  getPaletteColor(index: number): string {
    if (!index || index < 1) return this.palette[0];
    return this.palette[(index - 1) % 3] ?? this.palette[0];
  }

  /**
   * Update palette slot `index` (1-based) to `color`.
   * If the colour already exists in another slot the two slots are swapped,
   * keeping all three values distinct.
   */
  updatePaletteColor(index: number, color: string): void {
    if (!index || index < 1 || index > 3) return;
    const normalized = (color || '').toLowerCase();
    const pos = index - 1;
    if (this.palette[pos] === normalized) return;
    // Swap if the colour is already used elsewhere in the palette.
    const other = this.palette.findIndex((c, i) => i !== pos && c === normalized);
    if (other >= 0) {
      const tmp = this.palette[other];
      this.palette[other] = this.palette[pos];
      this.palette[pos] = tmp;
    } else {
      this.palette[pos] = normalized;
    }
    this.save();
  }

  // ── Highlight API ─────────────────────────────────────────────────────────

  updateHighlightColor(color: string): void {
    this.highlightColor = color.toLowerCase();
    this.save();
  }

  // ── Per-card colour overrides ─────────────────────────────────────────────

  getCardColor(cardId: string): string | undefined {
    return this.cardColors[cardId];
  }

  updateCardColor(color: string, cardId?: string, boardCardIds?: string[]): void {
    if (cardId) {
      this.cardColors[cardId] = color;
    } else if (boardCardIds) {
      for (const id of boardCardIds) {
        this.cardColors[id] = color;
      }
    }
  }

  /** Remove all per-card overrides. Call on new game. */
  clearCardColors(): void {
    this.cardColors = {};
  }
}
