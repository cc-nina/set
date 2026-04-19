import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';

// ─────────────────────────────────────────────────────────────────────────────
// To add a new theme in the future:
//   1. Add its name to the `Theme` union below.
//   2. Add it to `THEMES` in order.
//   3. Add an `html.<name> { ... }` block in styles.css with token overrides.
//   4. Optionally add an icon to `THEME_META` here.
// No component code needs to change.
// ─────────────────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark';

export const THEMES: readonly Theme[] = ['light', 'dark'] as const;

export const THEME_META: Record<Theme, { label: string; iconPath: string }> = {
  light: { 
    label: 'Light', 
    iconPath: 'M440-800v-120h80v120h-80Zm0 760v-120h80v120h-80Zm360-400v-80h120v80H800Zm-760 0v-80h120v80H40Zm708-252-56-56 70-72 58 58-72 70ZM198-140l-58-58 72-70 56 56-70 72Zm564 0-70-72 56-56 72 70-58 58ZM212-692l-72-70 58-58 70 72-56 56Zm98 382q-70-70-70-170t70-170q70-70 170-70t170 70q70 70 70 170t-70 170q-70 70-170 70t-170-70Zm283.5-56.5Q640-413 640-480t-46.5-113.5Q547-640 480-640t-113.5 46.5Q320-547 320-480t46.5 113.5Q413-320 480-320t113.5-46.5ZM480-480Z' 
  },
  dark: { 
    label: 'Dark',  
    iconPath: 'M484-80q-84 0-157.5-32t-128-86.5Q144-253 112-326.5T80-484q0-146 93-257.5T410-880q-18 99 11 193.5T521-521q71 71 165.5 100T880-410q-26 144-138 237T484-80Zm0-80q88 0 163-44t118-121q-86-8-163-43.5T464-465q-61-61-97-138t-43-163q-77 43-120.5 118.5T160-484q0 135 94.5 229.5T484-160Zm-20-305Z' 
  },
};

const STORAGE_KEY = 'app-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly isBrowser: boolean;

  /** Emits the currently active theme. */
  readonly theme$: BehaviorSubject<Theme>;

  get current(): Theme { return this.theme$.value; }

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
    const initial = this.resolveInitial();
    this.theme$ = new BehaviorSubject<Theme>(initial);
    this.apply(initial);
  }

  /** Cycle to the next theme in THEMES order. */
  cycle(): void {
    const idx  = THEMES.indexOf(this.current);
    const next = THEMES[(idx + 1) % THEMES.length];
    this.set(next);
  }

  /** Set a specific theme by name. */
  set(theme: Theme): void {
    if (!THEMES.includes(theme)) return;
    this.apply(theme);
    this.theme$.next(theme);
    if (this.isBrowser) {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private resolveInitial(): Theme {
    if (!this.isBrowser) return 'light';

    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored && (THEMES as readonly string[]).includes(stored)) return stored;

    // Fall back to OS preference.
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private apply(theme: Theme): void {
    if (!this.isBrowser) return;
    const html = document.documentElement;
    // Remove all theme classes, then add the active one (skip 'light' — it's the default).
    for (const t of THEMES) html.classList.remove(t);
    if (theme !== 'light') html.classList.add(theme);
  }
}
