import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { diffLines, type Change } from 'diff';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
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
 * Headless line-diff renderer. Computes `diffLines(oldText, newText)` and
 * renders either a unified or a side-by-side view with +/- highlighting.
 */
@Component({
  selector: 'app-diff-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonToggleModule, MatIconModule],
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

  protected readonly viewMode = signal<DiffMode | null>(null);
  protected readonly effectiveMode = computed<DiffMode>(() => this.viewMode() ?? this.mode());

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
