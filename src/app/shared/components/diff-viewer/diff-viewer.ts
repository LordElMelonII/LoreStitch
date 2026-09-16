import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { diffLines, type Change } from 'diff';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { type DiffLine, type DiffMode, type SplitRow } from './diff-viewer.model';

/** Splits a diff hunk value into display lines, dropping the phantom ''. */
function toLines(value: string, type: DiffLine['type']): DiffLine[] {
  const parts = value.split('\n');
  if (parts.length && parts.at(-1) === '') {
    parts.pop();
  }
  return parts.map((text) => ({ type, text }));
}

/**
 * Maps the start row of every contiguous change hunk to its hunk ordinal.
 * A hunk is a maximal run of rows that are not pure context — padding rows of
 * a split view belong to the hunk they pad.
 */
function hunkStartMap<T>(rows: T[], isChange: (row: T) => boolean): Map<number, number> {
  const starts = new Map<number, number>();
  let previousWasChange = false;
  rows.forEach((row, i) => {
    const change = isChange(row);
    if (change && !previousWasChange) {
      starts.set(i, starts.size);
    }
    previousWasChange = change;
  });
  return starts;
}

/**
 * Headless line-diff renderer. Computes `diffLines(oldText, newText)` and
 * renders either a unified or a side-by-side view with +/- highlighting.
 * A hunk navigator (prev / next) scrolls long diffs change by change.
 */
@Component({
  selector: 'app-diff-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatButtonToggleModule, MatIconModule, MatTooltipModule],
  templateUrl: './diff-viewer.html',
  styleUrl: './diff-viewer.scss',
  host: { class: 'app-diff-viewer' },
})
export class DiffViewer {
  readonly oldText = input.required<string>();
  readonly newText = input.required<string>();
  /** Render layout; mobile layouts should pass 'unified'. */
  readonly mode = input<DiffMode>('unified');
  /** When true the component shows its own unified/split switcher. */
  readonly interactive = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly viewMode = signal<DiffMode | null>(null);
  protected readonly effectiveMode = computed<DiffMode>(() => this.viewMode() ?? this.mode());

  /** The hunk the navigator is parked on (0-based; clamped to the diff). */
  protected readonly currentHunk = signal(0);

  protected readonly changes = computed<Change[]>(() =>
    diffLines(this.oldText() ?? '', this.newText() ?? ''),
  );

  protected readonly unifiedLines = computed<DiffLine[]>(() =>
    this.changes().flatMap((change) =>
      toLines(change.value, change.added ? 'added' : change.removed ? 'removed' : 'context'),
    ),
  );

  protected readonly splitRows = computed<SplitRow[]>(() => {
    const rows: SplitRow[] = [];
    const pending: Change[] = [];

    const flush = () => {
      if (!pending.length) {
        return;
      }
      const left: DiffLine[] = [];
      const right: DiffLine[] = [];
      for (const change of pending.splice(0)) {
        const lines = toLines(change.value, change.added ? 'added' : 'removed');
        if (change.added) {
          right.push(...lines);
        } else {
          left.push(...lines);
        }
      }
      const height = Math.max(left.length, right.length);
      for (let i = 0; i < height; i++) {
        rows.push({ left: left[i] ?? null, right: right[i] ?? null });
      }
    };

    for (const change of this.changes()) {
      if (change.added || change.removed) {
        pending.push(change);
      } else {
        flush();
        for (const line of toLines(change.value, 'context')) {
          rows.push({ left: line, right: line });
        }
      }
    }
    flush();
    return rows;
  });

  // Hunk grouping is identical in both views (they render the same changes),
  // so the maps are derived per view but the count and navigator are shared.
  protected readonly unifiedHunkStarts = computed(() =>
    hunkStartMap(this.unifiedLines(), (line) => line.type !== 'context'),
  );

  protected readonly splitHunkStarts = computed(() =>
    hunkStartMap(
      this.splitRows(),
      (row) => !(row.left?.type === 'context' && row.right?.type === 'context'),
    ),
  );

  protected readonly hunkCount = computed(() => {
    let count = 0;
    let inHunk = false;
    for (const change of this.changes()) {
      if (change.added || change.removed) {
        if (!inHunk) {
          count++;
          inHunk = true;
        }
      } else {
        inHunk = false;
      }
    }
    return count;
  });

  constructor() {
    // Whenever the diff itself changes (a new diff, or a unified/split switch)
    // park the navigator on the first change and scroll it into view, so even
    // a single-hunk diff is reachable without hunting through the scrollback.
    afterRenderEffect(() => {
      this.changes();
      this.effectiveMode();
      this.scrollToHunk(0);
    });
  }

  /** Scrolls the diff body to the nth hunk (wrapping out-of-range input). */
  protected goToHunk(index: number): void {
    this.scrollToHunk(index);
  }

  private scrollToHunk(index: number): void {
    const total = this.hunkCount();
    if (!total) {
      return;
    }
    const next = ((index % total) + total) % total;
    this.currentHunk.set(next);
    const body = this.host.nativeElement.querySelector<HTMLElement>('.diff-body');
    const target = this.host.nativeElement.querySelector<HTMLElement>(`[data-hunk="${next}"]`);
    if (body && target) {
      body.scrollTop = Math.max(0, target.offsetTop - 8);
    }
  }

  protected nextHunk(): void {
    this.goToHunk(this.currentHunk() + 1);
  }

  protected prevHunk(): void {
    this.goToHunk(this.currentHunk() - 1);
  }

  protected readonly stats = computed(() => {
    let added = 0;
    let removed = 0;
    for (const change of this.changes()) {
      const count = change.count ?? 0;
      if (change.added) {
        added += count;
      } else if (change.removed) {
        removed += count;
      }
    }
    return { added, removed };
  });
}
