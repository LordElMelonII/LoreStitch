import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconRegistry } from '@angular/material/icon';
import { MatTabGroup } from '@angular/material/tabs';
import { MatTooltip } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { APP_BUILD_INFO, type BuildInfo } from '../../core/models/build-info';
import { GITHUB_ICON } from '../../shared/constants/github';
import { AboutDialog } from './about-dialog';

/**
 * A second release above 1.0.0 exercises the multi-release rendering and the
 * em-dash heading; inline markdown verifies the parser's display stripping.
 */
const CHANGELOG = `# LoreStitch Changelog

Preamble the viewer must never show.

## 2.0.0 — March 1, 2027

The formatting release.

### Breaking changes

- Old projects need re-importing.

### Fixed

- Crash with **bold** text.

## 1.0.0 - September 17, 2026

### Highlights

- Version control \`built in\`.
`;

/** Installs a fetch stub returning a canned changelog response. */
function stubFetch(response: { ok: boolean; status?: number; text?: string }): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ...response, text: async () => response.text ?? CHANGELOG })));
}

describe('AboutDialog', () => {
  let closeSpy: ReturnType<typeof vi.fn<() => void>>;
  let dismissSpy: ReturnType<typeof vi.fn<() => void>>;
  let fixture: ComponentFixture<AboutDialog>;

  beforeEach(async () => {
    closeSpy = vi.fn();
    dismissSpy = vi.fn();
    stubFetch({ ok: true });
    TestBed.configureTestingModule({ imports: [AboutDialog] });
  });

  /**
   * Mounts the dialog with the given build metadata override and, optionally,
   * exactly one host container ref — in production only the ref of whichever
   * container opened the pane exists.
   */
  async function createDialog(
    buildInfo: Partial<BuildInfo> = {},
    refs: { dialog?: { close: () => void }; sheet?: { dismiss: () => void } } = {},
  ): Promise<AboutDialog> {
    TestBed.overrideProvider(APP_BUILD_INFO, { useValue: buildInfo });
    TestBed.overrideProvider(MatDialogRef, { useValue: refs.dialog ?? null });
    TestBed.overrideProvider(MatBottomSheetRef, { useValue: refs.sheet ?? null });
    // The template links to GitHub with the inlined registry literal (see
    // app.config); unit tests register it directly. This must come after the
    // overrides: injecting instantiates the test module.
    TestBed.inject(MatIconRegistry).addSvgIconLiteral(
      'github',
      TestBed.inject(DomSanitizer).bypassSecurityTrustHtml(GITHUB_ICON),
    );
    fixture = TestBed.createComponent(AboutDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /**
   * Activates the tab with the given label and returns its (lazily
   * instantiated) body pane. Drives the group's selectedIndex directly — the
   * real header-click path is covered by the Playwright suite. In the zoneless
   * TestBed a bare property write schedules nothing, so every tick marks the
   * host view dirty; Material then needs its ~100ms simulated-transition
   * fallback (jsdom fires no transitionend) before the pane activates —
   * `vi.waitFor` owns that timing budget.
   */
  async function selectTab(label: string): Promise<HTMLElement> {
    const tabHeaders = fixture.debugElement.queryAll(By.css('.mat-mdc-tab'));
    const index = tabHeaders.findIndex((tab) => tab.nativeElement.textContent?.includes(label));
    assert(index >= 0, `tab "${label}" not found`);
    const group = fixture.debugElement.query(By.directive(MatTabGroup))
      .componentInstance as MatTabGroup;
    const hostRef = fixture.componentRef.injector.get(ChangeDetectorRef);
    group.selectedIndex = index;

    let pane: HTMLElement | null = null;
    await vi.waitFor(
      () => {
        hostRef.markForCheck();
        fixture.detectChanges();
        pane = activePane(index);
        assert(pane, `tab "${label}" not active yet`);
      },
      { timeout: 5000, interval: 50 },
    );
    assert(pane);
    return pane;
  }

  /** The rendered `.tab-pane` of the active tab body, when it is tab `index`. */
  function activePane(index: number): HTMLElement | null {
    const bodies = (fixture.nativeElement as HTMLElement).querySelectorAll('.mat-mdc-tab-body');
    const active = Array.from(bodies).findIndex((body) =>
      body.classList.contains('mat-mdc-tab-body-active'),
    );
    return active === index ? (bodies[active]?.querySelector('.tab-pane') ?? null) : null;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders release build metadata from the injected build info', async () => {
    await createDialog({
      version: '1.0.0',
      buildTimestamp: '2026-09-01T12:00:00.000Z',
      gitCommitSha: 'abc7788def1234567890abcdef1234567890abcd',
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('LoreStitch');
    expect(text).toContain('1.0.0');
    // The commit renders shortened, with the full SHA in its tooltip.
    expect(text).toContain('abc7788');
    const shaHost = fixture.debugElement.query(By.css('.meta-value.mono'));
    assert(shaHost);
    expect(shaHost.injector.get(MatTooltip).message).toContain('abc7788def');
    // A timestamped build is a release: no development chip, formatted date.
    expect((fixture.nativeElement as HTMLElement).querySelector('.dev-chip')).toBeNull();
    expect(text).toContain('Sep 1, 2026');
  });

  it('flags development builds lacking a timestamp and commit', async () => {
    await createDialog({ version: '1.0.0', buildTimestamp: null, gitCommitSha: null });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.dev-chip')?.textContent).toContain('development build');
    expect(el.textContent).toContain('Development');
    // Placeholder em-dashes where release builds show date and commit.
    expect(el.textContent).toContain('—');
  });

  it('renders the parsed changelog with breaking highlights on the Changelog tab', async () => {
    await createDialog({ version: '1.0.0' });
    const pane = await selectTab('Changelog');
    const text = pane.textContent ?? '';

    // Preamble ignored; newest release first; both releases present.
    expect(text).not.toContain('Preamble');
    expect(text).toContain('2.0.0');
    expect(text).toContain('March 1, 2027');
    expect(text).toContain('1.0.0');

    // Breaking sections get the error emphasis class; markdown is stripped.
    const breaking = pane.querySelector('.section-title.breaking');
    expect(breaking?.textContent).toContain('Breaking changes');
    expect(pane.querySelector('.section-title:not(.breaking)')?.textContent).toContain('Fixed');
    expect(text).toContain('Crash with bold text.');
    expect(text).toContain('Version control built in.');
  });

  it('falls back gracefully when the changelog asset cannot be fetched', async () => {
    stubFetch({ ok: false, status: 404 });
    await createDialog({ version: '1.0.0' });
    const pane = await selectTab('Changelog');

    expect(pane.textContent).toContain('could not be loaded');
    expect(pane.textContent).toContain('Read it on GitHub');
  });

  it('shows an empty state when the changelog documents no releases', async () => {
    stubFetch({ ok: true, text: '# LoreStitch Changelog\n\nNothing released yet.\n' });
    await createDialog({ version: '1.0.0' });
    const pane = await selectTab('Changelog');

    expect(pane.textContent).toContain('No releases documented yet.');
  });

  it('lists open-source dependencies with licenses on the Open Source tab', async () => {
    await createDialog({ version: '1.0.0' });
    const pane = await selectTab('Open Source');
    const text = pane.textContent ?? '';

    expect(text).toContain('Runtime');
    expect(text).toContain('Build & testing');
    expect(text).toContain('Angular');
    expect(text).toContain('MIT');
    expect(text).toContain('diff (jsdiff)');
    expect(text).toContain('BSD-3-Clause');
    expect(text).toContain('Playwright');
    // Dependency names link out to their projects.
    const link = pane.querySelector<HTMLAnchorElement>('a.oss-name[href="https://angular.dev"]');
    expect(link).toBeTruthy();
  });

  it('closes through the dialog ref when hosted in a MatDialog', async () => {
    await createDialog({ version: '1.0.0' }, { dialog: { close: closeSpy } });
    const close = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-label="Close about"]',
    );
    assert(close);
    close.click();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(dismissSpy).not.toHaveBeenCalled();
  });

  it('dismisses through the bottom-sheet ref when hosted in a MatBottomSheet', async () => {
    await createDialog({ version: '1.0.0' }, { sheet: { dismiss: dismissSpy } });
    fixture.componentInstance['close']();

    expect(dismissSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
