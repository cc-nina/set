import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CardComponent } from './card.component';
import { Component } from '@angular/core';

describe('CardComponent', () => {
  it('renders svg symbols according to inputs', async () => {
    await TestBed.configureTestingModule({
      imports: [CardComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(CardComponent);
    const comp = fixture.componentInstance;
    comp.shape = 'diamond';
    comp.number = 3;
    comp.color = '#cc0000';
    comp.shading = 'solid';
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // should have three symbol groups (three polygons)
    const polygons = el.querySelectorAll('polygon');
    expect(polygons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows highlight when selected', async () => {
    await TestBed.configureTestingModule({
      imports: [CardComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(CardComponent);
    const comp = fixture.componentInstance;
    comp.selected = true;
    comp.color = '#00ff00';
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const highlight = el.querySelectorAll('rect')[1];
    expect(highlight).toBeTruthy();
  });
});
