import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
})
export class HomeComponent {
  constructor(private router: Router) {}

  startSinglePlayer(): void {
    this.router.navigate(['/game']);
  }

  createRoom(): void {
    // Navigates to /room/new — the GameRoomComponent will handle room creation.
    this.router.navigate(['/room', 'new']);
  }

  joinRoom(roomId: string): void {
    if (!roomId.trim()) return;
    this.router.navigate(['/room', roomId.trim()]);
  }
}
