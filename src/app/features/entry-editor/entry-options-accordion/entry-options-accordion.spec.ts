import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, computed, signal } from '@angular/core';
import { createEmptyEntry } from '../../../core/models/lorebook.model';
import type { ViewportClass } from '../../../shared/constants/breakpoints';
import { LayoutService } from '../../../shared/services/layout.service';
import { EntryOptionsAccordion } from './entry-options-accordion';

/**
 * Focused spec for the accordion's viewport wiring: the host `mobile` class
 * must track `LayoutService.isMobile` (the single source of viewport truth).
 * The trigger strip's composition is covered by the parent entry-editor spec;
 * the panel sections have their own specs.
 */
describe('EntryOptionsAccordion', () => {
  /** Configures the module once around a writable viewport signal. */
  async function mount(
    viewport: WritableSignal<ViewportClass>,
  ): Promise<ComponentFixture<EntryOptionsAccordion>> {
    TestBed.configureTestingModule({
      imports: [EntryOptionsAccordion],
      providers: [
        {
          provide: LayoutService,
          useValue: {
            viewport,
            isMobile: computed(() => viewport() === 'mobile'),
            isDesktop: computed(() => viewport() === 'desktop'),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(EntryOptionsAccordion);
    fixture.componentRef.setInput('entry', createEmptyEntry(0));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('binds the host mobile class to LayoutService.isMobile', async () => {
    const viewport = signal<ViewportClass>('mobile');
    const fixture = await mount(viewport);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('mobile')).toBe(true);

    // Resizing away from the phone class drops the host class again.
    viewport.set('desktop');
    fixture.detectChanges();
    expect(el.classList.contains('mobile')).toBe(false);

    viewport.set('mobile');
    fixture.detectChanges();
    expect(el.classList.contains('mobile')).toBe(true);
  });
});
