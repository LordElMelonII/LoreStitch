import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';
import { App } from './app';
import { GITHUB_ICON } from './shared/constants/github';

describe('App', () => {
  beforeEach(async () => {
    // CDK BreakpointObserver needs matchMedia, which jsdom does not provide.
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }),
      });
    }
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
    // The top bar renders the inlined GitHub mark. Its registration lives in
    // the app initializer (app.config), which unit tests bypass — replicate
    // it here so the icon registry does not log retrieval errors.
    TestBed.inject(MatIconRegistry).addSvgIconLiteral(
      'github',
      TestBed.inject(DomSanitizer).bypassSecurityTrustHtml(GITHUB_ICON),
    );
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the LoreStitch welcome screen when no project is open', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('LoreStitch');
  });
});
