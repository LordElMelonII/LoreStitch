import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { FormsModule } from '@angular/forms';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { entryTitle, entryTags } from '../../core/models/lorebook.model';
import { estimateEntryTokens, formatTokenCount } from '../../core/services/token-estimator';
import { WorkspaceService } from '../../core/services/workspace.service';
import {
  type ExportDependencyWarning,
  type ExportSelection,
  type ExportSelectionFormat,
  checkExportDependencies,
} from './export-selected.model';

/** Flattened row model of the selection list. */
interface ExportRow {
  id: number;
  title: string;
  tokens: number;
  tags: string[];
}

/** Payload handed to `ExportSelectedDialog`. */
export interface ExportSelectedDialogData {
  /** Entries pre-checked from the sidebar's batch selection. */
  preselectedIds?: number[];
}

/**
 * "Export Selected Entries as Lorebook": pick a subset of the working book,
 * name the split, choose the file format, and review selective-trigger
 * dependency warnings before the standalone file is written.
 *
 * Dual-container pane like the About pane: a centered `MatDialog`
 * (tablet/desktop) and a `MatBottomSheet` (phones, `.app-export-sheet`) share
 * this template — header fixed, body scrolling, actions pinned — so both refs
 * and both data tokens are injected optionally and `close()` routes to
 * whichever container is present.
 */
@Component({
  selector: 'app-export-selected-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ScrollingModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './export-selected-dialog.html',
  styleUrl: './export-selected-dialog.scss',
})
export class ExportSelectedDialog {
  /** Ref of the opening container — exactly one of the two is present. */
  private readonly dialogRef = inject(MatDialogRef<ExportSelectedDialog, ExportSelection | null>, {
    optional: true,
  });
  private readonly sheetRef = inject(
    MatBottomSheetRef<ExportSelectedDialog, ExportSelection | null>,
    { optional: true },
  );

  /** Payload from whichever container opened the pane (canonical at the caller). */
  protected readonly data: ExportSelectedDialogData =
    (inject(MAT_DIALOG_DATA, { optional: true }) as ExportSelectedDialogData | null) ??
    (inject(MAT_BOTTOM_SHEET_DATA, { optional: true }) as ExportSelectedDialogData | null) ??
    {};

  private readonly workspace = inject(WorkspaceService);

  protected readonly rows = computed<ExportRow[]>(() =>
    this.workspace.entries().flatMap((entry) =>
      entry.id === undefined
        ? []
        : [
            {
              id: entry.id,
              title: entryTitle(entry),
              tokens: estimateEntryTokens(entry),
              tags: entryTags(entry),
            },
          ],
    ),
  );

  protected readonly selected = signal<ReadonlySet<number>>(
    new Set(
      this.data.preselectedIds?.filter((id) =>
        this.workspace.entries().some((e) => e.id === id),
      ) ?? [],
    ),
  );

  protected readonly title = signal(this.defaultTitle());

  protected readonly format = signal<ExportSelectionFormat>('st_native');

  /** Live selective-trigger dependency warnings for the current selection. */
  protected readonly warnings = computed<ExportDependencyWarning[]>(() =>
    checkExportDependencies(this.workspace.entries(), this.selected()),
  );

  protected readonly selectionTokens = computed(() => {
    const selected = this.selected();
    return this.rows()
      .filter((row) => selected.has(row.id))
      .reduce((sum, row) => sum + row.tokens, 0);
  });

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  protected toggle(id: number, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected selectAll(): void {
    this.selected.set(new Set(this.rows().map((row) => row.id)));
  }

  protected selectNone(): void {
    this.selected.set(new Set());
  }

  protected invert(): void {
    this.selected.update((current) => {
      const next = new Set<number>();
      for (const row of this.rows()) {
        if (!current.has(row.id)) {
          next.add(row.id);
        }
      }
      return next;
    });
  }

  protected export(): void {
    const name = this.title().trim();
    if (!name || !this.selected().size) {
      return;
    }
    this.close({
      entryIds: [...this.selected()],
      title: name,
      format: this.format(),
    });
  }

  protected cancel(): void {
    this.close(null);
  }

  /** Closes the pane through whichever container opened it. */
  protected close(result: ExportSelection | null = null): void {
    this.dialogRef?.close(result);
    this.sheetRef?.dismiss(result);
  }

  protected formatTokens(tokens: number): string {
    return formatTokenCount(tokens);
  }

  /** Defaults the split name to "<project> (Selection)" or similar. */
  private defaultTitle(): string {
    const project = this.workspace.activeProject();
    const base = project?.title ?? 'Selection';
    const title = `${base} — Selection`;
    return title.slice(0, 200);
  }
}
