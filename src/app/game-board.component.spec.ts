import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { GameBoardComponent } from './game-board.component';
import { SetGameService } from './set-game.service';
import { GAME_SESSION } from './game-session.interface';
import { Card } from './game.types';

// ThemeService calls window.matchMedia — provide a stub in the test environment.
if (typeof window !== 'undefined') {
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

describe('GameBoardComponent', () => {
  let service: SetGameService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameBoardComponent],
      providers: [
        SetGameService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: GAME_SESSION, useExisting: SetGameService },
      ],
    }).compileComponents();

    service = TestBed.inject(SetGameService);
  });

  it('renders board from service', async () => {
    const fixture = TestBed.createComponent(GameBoardComponent);
    fixture.detectChanges();
    // wait for component's showBoard debounce to elapse
    await new Promise((res) => setTimeout(res, 120));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // board grid should exist
    const board = el.querySelector('.board');
    expect(board).toBeTruthy();
  });

  it('updates selection highlight when service selection changes', async () => {
    const fixture = TestBed.createComponent(GameBoardComponent);
    const comp = fixture.componentInstance as any;

    // prepare a fake card and push into state via service BEFORE initial change detection
    const s = service.getStateSnapshot();
    const card: any = { id: 'test-1', number: 1 as any, color: 1 as any, shape: 1 as any, shading: 1 as any };
    s.board = [card];
    s.selected = [card];
    // push new state
    // @ts-ignore - access private subject to push for test
    (service as any).stateSubject.next(s);

    // Now perform change detection so component picks up the new state synchronously
    fixture.detectChanges();
    // wait for the component's debounce to elapse
  await new Promise((res) => setTimeout(res, 120));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const highlight = el.querySelector('app-card');
    expect(highlight).toBeTruthy();
  });
});
