import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { WiTriggerState } from '../../core/models/lorebook.model';
import { KEY_CHIP_GAP_PX, digitsOf, fitKeyChips } from './entry-keys.model';

/**
 * One entry row's key strip (task 21, round-3 contract): key chips render at
 * their full natural width — never compressed, never ellipsized — and the
 * chips that do not fit the strip's measured width are not rendered at all;
 * the `+N` counter chip names them in its tooltip. The `constant` /
 * `vectorized` state chips always render and never compress.
 *
 * The fit is measurement-driven because chip widths are font metrics no
 * stylesheet can predict: a hidden measurement row lays out every chip (plus
 * a probe counter) so all widths stay measurable, a `ResizeObserver` feeds
 * the strip's live width (the drawer is user-resizable), and the pure fit in
 * `entry-keys.model.ts` divides the width greedily. The strip is a per-row
 * component because the virtual scroll re-materializes rows as it scrolls —
 * each instance owns its DOM and its measurement.
 */
@Component({
  selector: 'app-entry-keys',
  imports: [MatTooltipModule],
  templateUrl: './entry-keys.html',
  styleUrl: './entry-keys.scss',
  // Stable hook for row-layout selectors (and the e2e pins) that addressed
  // this strip as `.item-keys` before it became a component.
  host: { class: 'item-keys' },
})
export class EntryKeys {
  /** The entry's keys — rendered whole, hidden overflow counted in `+N`. */
  readonly keys = input.required<string[]>();

  /** Trigger state; drives the always-visible constant/vectorized chip. */
  readonly state = input.required<WiTriggerState>();

  /**
   * Content-box width of the strip, from the `ResizeObserver`. `null` until
   * the first measurement (and permanently where ResizeObserver is missing,
   * e.g. jsdom): the strip then renders every chip and its `overflow: hidden`
   * guards the transient — the fit, not the clip, is the steady state.
   */
  protected readonly containerWidth = signal<number | null>(null);

  /**
   * Hidden count the measurement row's probe counter is currently labeled
   * with. The fit needs the counter's width before it can decide how many
   * chips fit around it — the probe closes that loop: it always renders a
   * `+N` chip, its measured width feeds the fit, and when the fit lands on a
   * hidden count with a different digit count the probe relabels and the
   * measurement repeats. The chain is monotone (a wider counter only ever
   * hides more chips), so the loop converges instead of oscillating.
   */
  protected readonly probeCount = signal(0);

  /**
   * Bumped to force a re-measure without a size change: the text webfont
   * swaps in after first paint (`font-display: swap`), which re-metrics every
   * chip without resizing the flex-driven strip — no ResizeObserver fires.
   */
  private readonly measureTick = signal(0);

  /**
   * How many key chips the fit allows; `null` = not yet fitted (render all).
   * Written only by the fit effect below.
   */
  private readonly visibleCount = signal<number | null>(null);

  /** The whole key chips the fit keeps in the visible row. */
  protected readonly shownKeys = computed(() => {
    const visible = this.visibleCount();
    const keys = this.keys();
    return visible === null ? keys : keys.slice(0, visible);
  });

  /** The keys standing behind the `+N` counter (empty once all fit). */
  protected readonly hiddenKeys = computed(() => {
    const visible = this.visibleCount();
    const keys = this.keys();
    return visible === null ? [] : keys.slice(visible);
  });

  /** Every chip of the hidden measurement row, in DOM order: state chip (if
   * any), then all key chips. The probe counter carries its own query. */
  private readonly measureChips = viewChildren<ElementRef<HTMLElement>>('measureChip');
  private readonly probeChip = viewChild<ElementRef<HTMLElement>>('probeChip');

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    // Standard in every browser; skip exotic environments (e.g. bare jsdom)
    // rather than crash — same guard idiom as the list viewport's observers.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        // A zero-size report (the strip display:none inside a closed drawer)
        // is not a width to fit against — skip it; reopening reports the box.
        const width = entries.at(-1)?.contentRect.width;
        if (width) {
          this.containerWidth.set(width);
        }
      });
      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    }
    // Late font swap re-metrics the chips without resizing the strip.
    document.fonts?.ready.then(() => this.measureTick.update((tick) => tick + 1));

    // The fit runs as a reactive loop: every input (strip width, keys, state,
    // rendered measurement chips, probe label) is tracked, so virtual-scroll
    // row re-materialization, key edits and drawer resizes all re-fit, and
    // the probe relabel re-arms it until the digit count settles.
    effect(() => {
      const width = this.containerWidth();
      const keys = this.keys();
      const probe = this.probeCount();
      this.measureTick();
      if (width === null || keys.length === 0) {
        // Unmeasured or nothing to fit: render everything (the `no keys`
        // label case renders itself in the template).
        untracked(() => this.visibleCount.set(null));
        return;
      }
      const chips = this.measureChips();
      const hasStateChip = this.state() !== 'normal';
      const stateChipWidth = hasStateChip ? (chips[0]?.nativeElement.offsetWidth ?? 0) : 0;
      const keyWidths = (hasStateChip ? chips.slice(1) : chips).map(
        (chip) => chip.nativeElement.offsetWidth,
      );
      const counterWidth = this.probeChip()?.nativeElement.offsetWidth ?? 0;
      // The state chip owns its width plus one gap up front; the fit divides
      // the rest among key chips and the counter.
      const available = width - (stateChipWidth > 0 ? stateChipWidth + KEY_CHIP_GAP_PX : 0);
      const visible = fitKeyChips(available, keyWidths, KEY_CHIP_GAP_PX, () => counterWidth);
      untracked(() => {
        this.visibleCount.set(visible);
        // The fit consumed the probe's measured width for the label it
        // shows. When the resulting hidden count carries a different digit
        // count, the counter's true width differs — relabel and let this
        // effect re-run (monotone, see `probeCount`).
        const hidden = keys.length - visible;
        if (digitsOf(hidden) !== digitsOf(probe)) {
          this.probeCount.set(hidden);
        }
      });
    });
  }
}
