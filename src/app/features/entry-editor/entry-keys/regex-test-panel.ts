import { Component, computed, input, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_LOGIC_OPTIONS,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import {
  findStKeyMatches,
  type StKeyMatchRange,
  type StMatchOptions,
} from '../../../core/models/st-key-match';
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
 * `case_sensitive` and `match_whole_words` controls live. Nothing here writes
 * workspace state — chip add / remove / edit stay the only key mutations.
 */
@Component({
  selector: 'app-regex-test-panel',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  templateUrl: './regex-test-panel.html',
  styleUrl: './regex-test-panel.scss',
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

  /** The secondary keys' logic label, resolved like the Secondary Logic select. */
  private readonly logicLabel = computed(() => {
    const value = this.entry().extensions['selectiveLogic'];
    const logic = typeof value === 'number' ? value : ST_LOGIC_OPTIONS[0].value;
    return ST_LOGIC_OPTIONS.find((option) => option.value === logic)?.label ?? null;
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
