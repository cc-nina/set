import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HomeComponent } from './home.component';
import { GameBoardComponent } from './game-board.component';
import { routes } from './app.routes';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a fresh fixture + shared navigate spy. Spy is reset in beforeEach. */
function setup() {
  const fixture = TestBed.createComponent(HomeComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const router = TestBed.inject(Router);
  return { fixture, el, router };
}

// ── HomeComponent ─────────────────────────────────────────────────────────────

describe('HomeComponent', () => {
  let navigateSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    navigateSpy = vi.fn();

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [{ provide: Router, useValue: { navigate: navigateSpy } }],
    }).compileComponents();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  it('creates the component', () => {
    const { fixture } = setup();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the SET title', () => {
    const { el } = setup();
    expect(el.querySelector('.home-title')?.textContent?.trim()).toBe('SET');
  });

  it('renders three brand-colour dots in the logo', () => {
    const { el } = setup();
    const dots = el.querySelectorAll('.logo-dots .dot');
    expect(dots).toHaveLength(3);
  });

  it('renders Solo and Multiplayer mode cards', () => {
    const { el } = setup();
    const titles = Array.from(el.querySelectorAll('.mode-title')).map(
      (n) => n.textContent?.trim(),
    );
    expect(titles).toContain('Solo');
    expect(titles).toContain('Multiplayer');
  });

  it('renders a Create room button', () => {
    const { el } = setup();
    const btn = el.querySelector('.btn-primary') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('Create room');
  });

  it('renders a room-code input and a Join button', () => {
    const { el } = setup();
    expect(el.querySelector('.join-input')).toBeTruthy();
    expect(el.querySelector('.btn-secondary')?.textContent?.trim()).toBe('Join');
  });

  // ── Navigation methods ────────────────────────────────────────────────────

  it('startSinglePlayer navigates to /game', () => {
    const { fixture } = setup();
    fixture.componentInstance.startSinglePlayer();
    expect(navigateSpy).toHaveBeenCalledWith(['/game']);
  });

  it('createRoom navigates to /room/new', () => {
    const { fixture } = setup();
    fixture.componentInstance.createRoom();
    expect(navigateSpy).toHaveBeenCalledWith(['/room', 'new'], expect.objectContaining({ queryParams: expect.any(Object) }));
  });

  it('joinRoom navigates to the given room code', () => {
    const { fixture } = setup();
    fixture.componentInstance.joinRoom('abc123');
    expect(navigateSpy).toHaveBeenCalledWith(['/room', 'abc123'], expect.objectContaining({ queryParams: expect.any(Object) }));
  });

  it('joinRoom trims whitespace from the room code', () => {
    const { fixture } = setup();
    fixture.componentInstance.joinRoom('  abc123  ');
    expect(navigateSpy).toHaveBeenCalledWith(['/room', 'abc123'], expect.objectContaining({ queryParams: expect.any(Object) }));
  });

  it('joinRoom does nothing when the code is blank', () => {
    const { fixture } = setup();
    fixture.componentInstance.joinRoom('   ');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('joinRoom does nothing when the code is empty string', () => {
    const { fixture } = setup();
    fixture.componentInstance.joinRoom('');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // ── DOM interactions ──────────────────────────────────────────────────────

  it('clicking the Solo card navigates to /game', () => {
    const { el } = setup();
    const soloCard = el.querySelector<HTMLElement>('.mode-card:not(.mode-card--multi)')!;
    soloCard.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/game']);
  });

  it('pressing Enter on the Solo card navigates to /game', () => {
    const { el } = setup();
    const soloCard = el.querySelector<HTMLElement>('.mode-card:not(.mode-card--multi)')!;
    soloCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(navigateSpy).toHaveBeenCalledWith(['/game']);
  });

  it('pressing Space on the Solo card navigates to /game', () => {
    const { el } = setup();
    const soloCard = el.querySelector<HTMLElement>('.mode-card:not(.mode-card--multi)')!;
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    soloCard.dispatchEvent(event);
    expect(navigateSpy).toHaveBeenCalledWith(['/game']);
    expect(event.defaultPrevented).toBe(true); // page scroll must be suppressed
  });

  it('clicking Create room navigates to /room/new', () => {
    const { el } = setup();
    (el.querySelector('.btn-primary') as HTMLButtonElement).click();
    expect(navigateSpy).toHaveBeenCalledWith(['/room', 'new'], expect.objectContaining({ queryParams: expect.any(Object) }));
  });

  it('typing a code and clicking Join navigates to that room', () => {
    const { el } = setup();
    const input = el.querySelector<HTMLInputElement>('.join-input')!;
    const joinBtn = el.querySelector<HTMLButtonElement>('.btn-secondary')!;

    input.value = 'room-42';
    joinBtn.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/room', 'room-42'], expect.objectContaining({ queryParams: expect.any(Object) }));
  });

  it('pressing Enter in the room-code input navigates to that room', () => {
    const { el } = setup();
    const input = el.querySelector<HTMLInputElement>('.join-input')!;

    input.value = 'enter-room';
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(navigateSpy).toHaveBeenCalledWith(['/room', 'enter-room'], expect.objectContaining({ queryParams: expect.any(Object) }));
  });

  it('clicking Join with an empty input does not navigate', () => {
    const { el } = setup();
    const input = el.querySelector<HTMLInputElement>('.join-input')!;
    input.value = '';
    (el.querySelector('.btn-secondary') as HTMLButtonElement).click();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// ── Router configuration ──────────────────────────────────────────────────────

describe('app routes configuration', () => {
  it('has a route for the home screen at ""', () => {
    const home = routes.find((r) => r.path === '');
    expect(home).toBeDefined();
    expect(typeof (home as any).loadComponent).toBe('function');
  });

  it('home route lazy-loads HomeComponent', async () => {
    const home = routes.find((r) => r.path === '')!;
    const mod = await (home as any).loadComponent();
    expect(mod).toBe(HomeComponent);
  });

  it('has a route for the game board at "game"', () => {
    const game = routes.find((r) => r.path === 'game');
    expect(game).toBeDefined();
    expect(typeof (game as any).loadComponent).toBe('function');
  });

  it('game route lazy-loads GameBoardComponent', async () => {
    const game = routes.find((r) => r.path === 'game')!;
    const mod = await (game as any).loadComponent();
    expect(mod).toBe(GameBoardComponent);
  });

  it('has a route for rooms at "room/:roomId"', () => {
    const room = routes.find((r) => r.path === 'room/:roomId');
    expect(room).toBeDefined();
    expect(typeof (room as any).loadComponent).toBe('function');
  });

  it('has a catch-all that redirects to ""', () => {
    const catchAll = routes.find((r) => r.path === '**');
    expect(catchAll).toBeDefined();
    expect((catchAll as any).redirectTo).toBe('');
  });

  it('routes array has exactly 4 entries', () => {
    // home, game, room/:roomId, **
    expect(routes).toHaveLength(4);
  });
});
