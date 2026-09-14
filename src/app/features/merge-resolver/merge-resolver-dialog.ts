import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry, entryTitle } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import {
  type MergeAction,
  type MergeDialogData,
  type MergeOutcome,
  type MergePendingCounts,
  type MergeRow,
} from './merge-resolver.model';
import { DiffViewer } from '../../shared/components/diff-viewer/diff-viewer';

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function keySet(entry: CharacterBookEntry): Set<string> {
  return new Set((entry.keys ?? []).map(normalizeKey).filter((k) => k.length > 0));
}

/** Cherry-picker for merging a second lorebook into the current one. */
@Component({
  selector: 'app-merge-resolver-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    DiffViewer,
  ],
  templateUrl: './merge-resolver-dialog.html',
  styleUrl: './merge-resolver-dialog.scss',
})
export class MergeResolverDialog {
  private readonly dialogRef = inject(MatDialogRef<MergeResolverDialog, MergeOutcome | null>);
  protected readonly data = inject<MergeDialogData>(MAT_DIALOG_DATA);
  private readonly workspace = inject(WorkspaceService);

  /** Per-entry action, keyed by incoming entry id (falls back to index). */
  protected readonly actions = signal<Map<number, MergeAction>>(new Map());
  protected readonly expanded = signal<number | null>(null);

  protected readonly rows = computed<MergeRow[]>(() => {
    return this.data.incoming.entries.map((incoming) => {
      const local = this.findLocalMatch(incoming);
      const identical =
        local !== null &&
        local.content === incoming.content &&
        JSON.stringify(local.keys) === JSON.stringify(incoming.keys);
      return { incoming, local, identical };
    });
  });

  protected readonly clashCount = computed(
    () => this.rows().filter((r) => r.local !== null && !r.identical).length,
  );

  constructor() {
    // Seed defaults: identical entries are skipped, everything else imports as new.
    const initial = new Map<number, MergeAction>();
    this.rows().forEach((row, index) => {
      initial.set(index, row.identical ? 'skip' : 'import');
    });
    this.actions.set(initial);
  }

  /** Entry index is stable while the dialog is open, so it keys the map. */
  protected action(index: number): MergeAction {
    return this.actions().get(index) ?? 'import';
  }

  protected setAction(index: number, action: MergeAction): void {
    this.actions.update((map) => new Map(map).set(index, action));
  }

  protected setAll(action: MergeAction, onlyMatched = false): void {
    const next = new Map<number, MergeAction>();
    this.rows().forEach((row, index) => {
      if (!onlyMatched || (row.local !== null && !row.identical)) {
        next.set(index, action);
      } else {
        next.set(index, this.action(index));
      }
    });
    this.actions.set(next);
  }

  protected pendingCounts = computed<MergePendingCounts>(() => {
    const counts: MergePendingCounts = { import: 0, overwrite: 0, skip: 0 };
    this.rows().forEach((_row, index) => counts[this.action(index)]++);
    return counts;
  });

  protected toggleExpand(index: number): void {
    this.expanded.update((current) => (current === index ? null : index));
  }

  protected apply(): void {
    const current = [...this.workspace.entries()];
    let nextId = current.reduce((max, e) => Math.max(max, e.id ?? 0), -1) + 1;
    let imported = 0;
    let overwritten = 0;
    let skipped = 0;

    this.rows().forEach((row, index) => {
      switch (this.action(index)) {
        case 'import': {
          const clone = structuredClone(row.incoming);
          clone.id = nextId++;
          if (clone.extensions) {
            clone.extensions['display_index'] = current.length;
          } else {
            clone.extensions = { display_index: current.length };
          }
          current.push(clone);
          imported++;
          break;
        }
        case 'overwrite': {
          const target = row.local;
          const indexInBook = target ? current.findIndex((e) => e.id === target.id) : -1;
          if (indexInBook >= 0) {
            const clone = structuredClone(row.incoming);
            clone.id = current[indexInBook].id;
            current[indexInBook] = clone;
            overwritten++;
          } else {
            skipped++;
          }
          break;
        }
        default:
          skipped++;
      }
    });

    this.dialogRef.close({ entries: current, imported, overwritten, skipped });
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }

  protected title(entry: CharacterBookEntry): string {
    return entryTitle(entry);
  }

  /** Finds a clashing local entry by id, then by overlapping primary keys. */
  private findLocalMatch(incoming: CharacterBookEntry): CharacterBookEntry | null {
    const current = this.workspace.entries();
    if (incoming.id !== undefined) {
      const byId = current.find((e) => e.id === incoming.id);
      if (byId) {
        return byId;
      }
    }
    const incomingKeys = keySet(incoming);
    if (!incomingKeys.size) {
      return null;
    }
    return (
      current.find((local) => {
        const localKeys = keySet(local);
        for (const key of incomingKeys) {
          if (localKeys.has(key)) {
            return true;
          }
        }
        return false;
      }) ?? null
    );
  }
}
