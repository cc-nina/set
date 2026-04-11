import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService, THEME_META } from './theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App {
  protected readonly meta = THEME_META;
  constructor(protected readonly theme: ThemeService) {}
}
