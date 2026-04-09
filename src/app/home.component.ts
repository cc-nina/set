import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
})
export class HomeComponent {
  maxPlayers = 2;

  constructor(private router: Router) {}

  startSinglePlayer(): void {
    this.router.navigate(['/game']);
  }

  createRoom(): void {
    this.router.navigate(['/room', 'new'], {
      queryParams: { maxPlayers: this.maxPlayers },
    });
  }

  joinRoom(roomId: string): void {
    if (!roomId.trim()) return;
    this.router.navigate(['/room', roomId.trim()]);
  }
}
