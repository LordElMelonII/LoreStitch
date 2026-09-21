import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_LOGIC,
  ST_LOGIC_OPTIONS,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import {
  findStKeyMatches,
  type StKeyMatchRange,
  type StMatchOptions,
} from '../../../core/models/st-key-match';
import { evaluateStTrigger, type StTriggerVerdict } from '../../../core/models/st-trigger';
import { classifyStKey, type StKeyClass } from '../../../core/models/st-regex';
import {
  HIGHLIGHT_CLAMP,
  highlightSegments,
  type TextSegment,
} from './highlight-segments';
import { MatButtonModule } from '@angular/material/button';

/** Radius around the first match when excerpting (~60 chars in total). */
const EXCERPT_RADIUS = 30;

/** Which fact a match row announces. Drives the literal `@switch` icons. */
type MatchRowKind = 'invalid' | 'matched' | 'not-matched';

/** One per-key row of the match list (§3.6 §4). */
interface MatchRow {
  readonly key: string;
  /** Which key list the row came from — colors the icon and the preview. */
  readonly tone: 'primary' | 'secondary';
  readonly cls: StKeyClass;
  readonly kind: MatchRowKind;
  /** §3.4 verbatim state word; the invalid wording replaces Matches/No match. */
  readonly stateLabel: string;
  readonly excerpt: string | null;
  /** Decorative logic label on secondary rows; null on primary rows. */
  readonly logicLabel: string | null;
  readonly ranges: readonly StKeyMatchRange[];
}

/**
 * Up to ~60 chars of `text` centered on the first match, `…`-trimmed on
 * both sides. Locating only — highlighting is the preview's job.
 */
function excerptAround(text: string, range: StKeyMatchRange): string {
  const start = Math.max(0, range.start - EXCERPT_RADIUS);
  const end = Math.min(text.length, range.end + EXCERPT_RADIUS);
  const body = text.slice(start, end);
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

/**
 * The "Test keys" playground (Task 04 §3.3): a collapsible, presentation-only
 * sandbox mounted by `EntryKeys` below the Secondary Logic row. A component-
 * local sample text drives per-key match rows and a read-only highlighted
 * preview through `findStKeyMatches`, honoring the sibling sections'
 * `case_sensitive` and `match_whole_words` controls live, and states the
 * joint SillyTavern trigger verdict over those same facts
 * (`evaluateStTrigger`, Task 08 §3.2). Nothing here writes workspace state —
 * chip add / remove / edit stay the only key mutations.
 */
@Component({
  selector: 'app-regex-test-panel',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  templateUrl: './regex-test-panel.html',
  styleUrl: './regex-test-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegexTestPanel {
  /** The entry being edited (owned by the enclosing `EntryKeys` section). */
  readonly entry = input.required<CharacterBookEntry>();

  /** Component-local sample text — never workspace state, nothing persists. */
  protected readonly sample = signal('');

  /** Collapsed by default; content stays mounted so the sample survives. */
  protected readonly open = signal(false);

  /** Stable id for the collapsible content / `aria-controls` pair. */
  protected readonly panelId = computed(() => `regex-test-panel-${this.entry().id}`);

  /** Mount gating (§3.3): constant entries ignore all keys; keyless have nothing to test. */
  protected readonly visible = computed(() => {
    const entry = this.entry();
    if (entryTriggerState(entry) === 'constant') {
      return false;
    }
    return (
      entry.keys.length > 0 ||
      (entry.selective === true && (entry.secondary_keys ?? []).length > 0)
    );
  });

  /**
   * ST's resolved matching options (§3.3): entry overrides over the ST global
   * defaults (`false`) — the `null` "Default (book setting)" tri-state
   * resolves to `false`, typed with a boolean guard, no casts.
   */
  private readonly matchOptions = computed<StMatchOptions>(() => {
    const entry = this.entry();
    const wholeWords = entry.extensions['match_whole_words'];
    return {
      caseSensitive: entry.case_sensitive ?? false,
      matchWholeWords: typeof wholeWords === 'boolean' ? wholeWords : false,
    };
  });

  /** The entry's resolved secondary logic — ST's AND_ANY default when unset. */
  private readonly selectiveLogic = computed<number>(() => {
    const value = this.entry().extensions['selectiveLogic'];
    return typeof value === 'number' ? value : ST_LOGIC.AND_ANY;
  });

  /** The secondary keys' logic label, resolved like the Secondary Logic select. */
  private readonly logicLabel = computed(() => {
    return ST_LOGIC_OPTIONS.find((option) => option.value === this.selectiveLogic())?.label ?? null;
  });

  /** Per-key rows: primary keys first then secondary, list order (§3.3). */
  protected readonly rows = computed<readonly MatchRow[]>(() => {
    const sample = this.sample();
    const options = this.matchOptions();
    const entry = this.entry();
    const build = (
      key: string,
      tone: 'primary' | 'secondary',
      logicLabel: string | null,
    ): MatchRow => {
      const cls = classifyStKey(key);
      // `findStKeyMatches` reports ranges into its evaluated text; ordinary
      // prose case-folds length-stably, so the offsets index the raw sample
      // directly (Task 04 §3.1 — no normalization machinery by design).
      const ranges = findStKeyMatches(key, sample, options);
      const first = ranges[0];
      const matched = ranges.length > 0;
      return {
        key,
        tone,
        cls,
        kind: cls === 'invalid-regex' ? 'invalid' : matched ? 'matched' : 'not-matched',
        stateLabel:
          cls === 'invalid-regex'
            ? 'Invalid regex — treated as plain text'
            : matched
              ? 'Matches'
              : 'No match',
        excerpt: first ? excerptAround(sample, first) : null,
        logicLabel,
        ranges,
      };
    };
    return [
      ...entry.keys.map((key) => build(key, 'primary', null)),
      ...(entry.selective === true
        ? (entry.secondary_keys ?? []).map((key) => build(key, 'secondary', this.logicLabel()))
        : []),
    ];
  });

  /**
   * The entry-level verdict for the current sample (Task 08 §3.2): would
   * SillyTavern insert this entry for this text? Derived from the SAME
   * per-key facts the rows below show — `anyPrimaryMatched` over the primary
   * rows, one boolean per secondary row in list order — so the banner and
   * the rows can never disagree. Pure: reads only `rows` (sample + options +
   * entry) and the entry itself.
   */
  protected readonly verdict = computed<StTriggerVerdict>(() => {
    let anyPrimaryMatched = false;
    const secondaryMatched: boolean[] = [];
    for (const row of this.rows()) {
      if (row.tone === 'primary') {
        anyPrimaryMatched = anyPrimaryMatched || row.kind === 'matched';
      } else {
        secondaryMatched.push(row.kind === 'matched');
      }
    }
    return evaluateStTrigger(this.entry(), { anyPrimaryMatched, secondaryMatched });
  });

  /** Banner classes for the verdict's outlook (the SCSS container pairs). */
  protected readonly verdictClass = computed(() => `verdict verdict-${this.verdict().outlook}`);

  /**
   * Cause clause of the blocked headline for the `secondary-logic-denied`
   * reason — what blocks depends on the gate's mode: under NOT_* it is the
   * matched keys, under AND_* something is missing instead. The quoted label
   * is the entry's actual logic; an out-of-enum vendor value satisfies no
   * branch of the oracle's gate (fall-through deny), so it takes the generic
   * cause. Empty unless the verdict is `secondary-logic-denied`.
   */
  protected readonly verdictCause = computed<string>(() => {
    if (this.verdict().reason !== 'secondary-logic-denied') {
      return '';
    }
    const label = this.logicLabel();
    if (label === null) {
      return 'the entry’s secondary-key logic denies activation.';
    }
    const logic = this.selectiveLogic();
    if (logic === ST_LOGIC.NOT_ALL || logic === ST_LOGIC.NOT_ANY) {
      return `the matched “${label}” secondary keys block activation.`;
    }
    if (logic === ST_LOGIC.AND_ANY) {
      return `no “${label}” secondary key matches this sample.`;
    }
    if (logic === ST_LOGIC.AND_ALL) {
      return `not every “${label}” secondary key matches this sample.`;
    }
    return 'the entry’s secondary-key logic denies activation.';
  });

  /**
   * Checkpoint 08-1 (treatment 1): matched secondary rows wear the
   * "(blocks activation)" suffix only under the NOT_* gates, where the
   * matched keys are literally what denies — under AND_* a matched row is
   * not the blocker. Driven off `verdict`, never re-derived, so the suffix
   * and the banner can never disagree.
   */
  protected readonly matchedSecondaryBlocks = computed(() => {
    if (this.verdict().reason !== 'secondary-logic-denied') {
      return false;
    }
    const logic = this.selectiveLogic();
    return logic === ST_LOGIC.NOT_ALL || logic === ST_LOGIC.NOT_ANY;
  });

  /** Read-only preview spans over the raw sample (aria-hidden in the DOM). */
  protected readonly segments = computed<readonly TextSegment[]>(() =>
    highlightSegments(
      this.sample(),
      this.rows().map((row) => ({ tone: row.tone, ranges: row.ranges })),
    ),
  );

  /** True when the sample produced more matches than the preview paints. */
  protected readonly truncated = computed(
    () => this.rows().reduce((total, row) => total + row.ranges.length, 0) > HIGHLIGHT_CLAMP,
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected setSample(event: Event): void {
    this.sample.set((event.target as HTMLTextAreaElement).value);
  }
}
