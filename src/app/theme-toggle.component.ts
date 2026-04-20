import { Component } from '@angular/core';
import { ThemeService, THEME_META } from './theme.service';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <button
      class="theme-toggle-btn"
      (click)="theme.cycle()"
      [attr.aria-label]="theme.current === 'light' ? 'Switch to dark mode' : 'Switch to light mode'"
    >
      <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px">
        <path [attr.d]="theme.current === 'light' ? meta.dark.iconPath : meta.light.iconPath" />
      </svg>
    </button>
  `,
  styles: [`
    :host { display: contents; }

    .theme-toggle-btn {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      border: 1.5px solid var(--border-strong);
      background: var(--bg-surface);
      color: var(--text-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: var(--shadow-sm);
      flex-shrink: 0;
      transition: var(--theme-transition), transform 0.1s;
    }

    svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
      transition: transform 0.3s ease;
    }

    @media (hover: hover) {
      .theme-toggle-btn:hover {
        background: var(--bg-surface-alt);
        border-color: var(--border);
        box-shadow: var(--shadow-md);
      }

      .theme-toggle-btn:hover svg {
        transform: rotate(45deg);
      }
    }

    .theme-toggle-btn:active { transform: scale(0.92); }
  `],
})
export class ThemeToggleComponent {
  protected readonly meta = THEME_META;
  constructor(protected readonly theme: ThemeService) {}
}
