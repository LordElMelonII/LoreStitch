import { TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideAnimationsAsync()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Welcome to LoreStitch');
  });

  it('should increment and compute double counter correctly', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    expect(app.counter()).toBe(0);
    expect(app.doubleCount()).toBe(0);

    app.increment();
    expect(app.counter()).toBe(1);
    expect(app.doubleCount()).toBe(2);
  });
});
