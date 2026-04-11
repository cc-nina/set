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

export const THEME_META: Record<Theme, { label: string; icon: string }> = {
  light: { label: 'Light',    icon: '☀️' },
  dark:  { label: 'Dark',     icon: '🌙' },
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
