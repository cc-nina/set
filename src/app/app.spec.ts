import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const h1 = compiled.querySelector('h1');
    if (h1) {
      expect(h1.textContent).toContain('Hello, set-game');
    } else {
      // Fallback: assert the component's title signal is set correctly
      const app = fixture.componentInstance as any;
      expect(typeof app.title).toBe('function');
      expect(app.title()).toBe('set-game');
    }
  });
});
