import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { type BookDefectKind } from '../../../core/models/book-schema';
import { type RepairChangeKind } from '../../../core/models/book-repair';
import { type BookRepairDialogData } from './book-repair-dialog.model';

/** Dialog-ready label per planned write (approved copy, checkpoint 09-1). */
const KIND_LABELS: Record<RepairChangeKind, string> = {
  'coerce-id': 'Id corrected',
  'reassign-id': 'Id renumbered',
  'default-insertion-order': 'Insertion order set',
  'unset-priority': 'Priority unset',
};

/** The one field a change writes, named in its detail line. */
const FIELD_LABELS: Record<RepairChangeKind, string> = {
  'coerce-id': 'id',
  'reassign-id': 'id',
  'default-insertion-order': 'insertion order',
  'unset-priority': 'priority',
};

/**
 * Short sentence per defect kind for the hard-block rows. The fixable kinds
 * are unreachable in the block list today (a repair exists whenever only they
 * are flagged) but the map stays total — `planBookRepair` also returns `null`
 * when the book's tree cannot be structured-cloned, and those defects must
 * still render.
 */
const DEFECT_SENTENCES: Record<BookDefectKind, string> = {
  'entry-id-not-finite': 'Id is not a finite number',
  'entry-id-duplicate': 'Id is a duplicate',
  'entry-content-not-string': 'Content is not text',
  'entry-keys-not-string-array': 'Keys is not a list of keywords',
  'entry-secondary-keys-not-string-array': 'Secondary keys is not a list of keywords',
  'entry-insertion-order-not-finite': 'Insertion order is not a finite number',
  'entry-priority-not-finite': 'Priority is not a finite number',
  'entry-extensions-not-object': 'Extensions is not an object',
  'book-entries-not-array': 'The entries collection is malformed',
};

/**
 * Guided book repair (plan 09 §3.3): renders the planner's change list and
 * closes truthy on "Fix N issues & …", falsy on "Import as-is" / "Cancel" /
 * dismissal — the ConfirmDialog boolean-result contract.
 *
 * Dual-container pane like the About pane: a centered `MatDialog`
 * (tablet/desktop, `.app-repair-dialog`) and a content-hugging
 * `MatBottomSheet` (phones, `.app-repair-sheet`) share this template, so both
 * refs and both data tokens are injected optionally and `close()` routes to
 * whichever container is present. Opened ONLY through
 * `ResponsiveOverlayService.openResponsive` — never directly.
 */
@Component({
  selector: 'app-book-repair-dialog',
  imports: [MatIconModule, MatButtonModule],
  template: `
    <div class="pane" [class.sheet]="isSheet">
      @if (isSheet) {
        <div class="drag-handle" aria-hidden="true"></div>
      }
      <h2 class="title">
        <mat-icon aria-hidden="true">{{ repair ? 'tune' : 'block' }}</mat-icon>
        <span>{{ title }}</span>
      </h2>
      <div class="content">
        <p class="message">{{ message }}</p>
        @if (repair; as plan) {
          <ul class="change-list">
            @for (change of plan.changes; track $index) {
              <li class="change">
                <div class="change-head">
                  <span class="change-title">{{ change.entryTitle }}</span>
                  <span class="change-kind">{{ KIND_LABELS[change.kind] }}</span>
                </div>
                <div class="change-detail">
                  <span>{{ FIELD_LABELS[change.kind] }}</span>
                  <span class="val from">{{ change.from }}</span>
                  <mat-icon aria-hidden="true" class="arrow">arrow_forward</mat-icon>
                  <span class="val to">{{ change.to }}</span>
                </div>
              </li>
            }
          </ul>
        } @else {
          @if (data.source) {
            <p class="source">{{ data.source }}</p>
          }
          <ul class="block-list">
            @for (row of blockRows; track $index) {
              <li class="block-row">
                <mat-icon aria-hidden="true">error</mat-icon>
                <span class="block-text">
                  @if (row.title) {
                    <strong>{{ row.title }}</strong> —
                  }
                  {{ row.sentence }}
                </span>
              </li>
            }
          </ul>
        }
      </div>
      <div class="actions">
        @if (repair) {
          <button matButton type="button" (click)="close(false)">{{ secondaryLabel }}</button>
          <button matButton="filled" type="button" (click)="close(true)">{{ primaryLabel }}</button>
        } @else {
          <button matButton="filled" type="button" (click)="close(false)">Close</button>
        }
      </div>
    </div>
  `,
  styles: `
    // The approved mock's stylesheet (checkpoint 09-1) translated to component
    // styles — M3 tokens only. Container chrome (surface background, sheet
    // radius, zero padding) lives in the global .app-repair-dialog /
    // .app-repair-sheet rules; this pane paints everything inside it.
    .pane {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
      padding: 24px;
    }

    // Phone sheet form: drag handle + tighter inset per the approved mock.
    .pane.sheet {
      padding: 8px 20px 20px;
    }

    .drag-handle {
      width: 32px;
      height: 4px;
      border-radius: 2px;
      background: var(--mat-sys-on-surface-variant);
      opacity: 0.4;
      margin: 8px auto 4px;
    }

    .title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 12px;
      font: var(--mat-sys-headline-small);
      color: var(--mat-sys-on-surface);

      mat-icon {
        flex: none;
        width: 20px;
        height: 20px;
        font-size: 20px;
        color: var(--mat-sys-primary);
      }
    }

    .message {
      margin: 0 0 12px;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    // Snapshot hard-block attribution, verbatim (plan 09 §3.5).
    .source {
      margin: 0 0 12px;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    .change-list {
      list-style: none;
      margin: 0 0 4px;
      padding: 0;
      display: grid;
      gap: 8px;
      // Plan 09 §7.5 flood mitigation: the list scrolls instead of stretching
      // the pane, keeping the actions reachable.
      max-height: min(42dvh, 380px);
      overflow: auto;
    }

    .change {
      background: var(--mat-sys-surface-container-low);
      border-radius: 12px;
      padding: 10px 12px;
    }

    .change-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }

    .change-title {
      font: var(--mat-sys-title-small);
    }

    .change-kind {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-tertiary);
      white-space: nowrap;
    }

    .change-detail {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);

      .arrow {
        flex: none;
        width: 16px;
        height: 16px;
        font-size: 16px;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    // From-value chip: quiet outlined surface; to-value chip: filled primary —
    // the emphasis sits on the value the fix writes, per the approved mock.
    .val {
      padding: 1px 8px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-highest);
      border: 1px solid var(--mat-sys-outline-variant);
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface);
    }

    .val.to {
      color: var(--mat-sys-on-primary);
      background: var(--mat-sys-primary);
      border-color: transparent;
    }

    .block-list {
      list-style: none;
      margin: 0 0 4px;
      padding: 0;
      display: grid;
      gap: 8px;
      max-height: min(42dvh, 380px);
      overflow: auto;
    }

    .block-row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);

      mat-icon {
        flex: none;
        width: 18px;
        height: 18px;
        font-size: 18px;
        margin-top: 1px;
        color: var(--mat-sys-on-error-container);
      }
    }

    .block-text {
      font: var(--mat-sys-body-medium);
    }

    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
    }

    // Stacked full-width buttons on the sheet: the filled primary on top
    // (column-reverse over the secondary-first DOM order), per the mock.
    .pane.sheet .actions {
      flex-direction: column-reverse;

      button {
        width: 100%;
      }
    }
  `,
})
export class BookRepairDialog {
  /** Ref of the opening container — exactly one of the two is present. */
  private readonly dialogRef = inject(MatDialogRef<BookRepairDialog, boolean>, {
    optional: true,
  });
  private readonly sheetRef = inject(MatBottomSheetRef<BookRepairDialog, boolean>, {
    optional: true,
  });

  /** Payload from whichever container opened the pane (canonical at the caller). */
  protected readonly data: BookRepairDialogData =
    (inject(MAT_DIALOG_DATA, { optional: true }) as BookRepairDialogData | null) ??
    (inject(MAT_BOTTOM_SHEET_DATA, { optional: true }) as BookRepairDialogData | null) ?? {
      context: 'import' as const,
      repair: null,
      defects: [],
      bookTitle: '',
    };

  protected readonly KIND_LABELS = KIND_LABELS;
  protected readonly FIELD_LABELS = FIELD_LABELS;

  /** True when the pane opened as a phone bottom sheet (drag handle, stacked actions). */
  protected readonly isSheet = this.sheetRef !== null;

  protected readonly repair = this.data.repair;

  /** "Fix 1 issue …" vs "Fix N issues …" — the approved pluralization. */
  protected readonly issueNoun = this.data.repair?.changes.length === 1 ? 'issue' : 'issues';

  protected readonly title: string = this.repair
    ? `Fix ${this.repair.changes.length} ${this.issueNoun} before ${
        this.data.context === 'import' ? 'importing' : 'exporting'
      }?`
    : 'This book can’t be exported yet';

  protected readonly message: string = this.repair
    ? this.data.context === 'import'
      ? 'This book carries malformed entry ids and values that would break it in SillyTavern. ' +
        'Only the fields listed below change — every entry, key and vendor field rides along verbatim.'
      : 'This book carries malformed entry ids and values that would break it in SillyTavern. ' +
        'Fixing rewrites those fields in the workspace, then the export proceeds.'
    : 'Some problems have no automatic fix. Repair the entries listed below in the editor, ' +
      'or import a corrected file.';

  protected readonly primaryLabel: string = this.repair
    ? `Fix ${this.repair.changes.length} ${this.issueNoun} & ${
        this.data.context === 'import' ? 'import' : 'export'
      }`
    : 'Close';

  protected readonly secondaryLabel = this.data.context === 'import' ? 'Import as-is' : 'Cancel';

  /** Hard-block rows: `<title> — <sentence>`, no name prefix on book-level kinds. */
  protected readonly blockRows: readonly { title: string | null; sentence: string }[] =
    this.data.defects.map((defect) => ({
      title:
        defect.kind === 'book-entries-not-array'
          ? null
          : (defect.entryTitle ?? 'An entry'),
      sentence: DEFECT_SENTENCES[defect.kind],
    }));

  constructor() {
    // Plan 09 §7.5 flood mitigation: the list scrolls and the copy carries
    // the count — the devtools warn keeps the full defect + change detail.
    console.warn(
      `[book-repair] ${this.data.context} — “${this.data.bookTitle}”: ` +
        `${this.data.defects.length} defect(s), ` +
        `${this.data.repair ? `${this.data.repair.changes.length} planned change(s)` : 'no automatic fix'}`,
      { defects: this.data.defects, changes: this.data.repair?.changes ?? null },
    );
  }

  /** Truthy only on the repair consent ("Fix N issues & …"); Close declines. */
  protected close(result: boolean): void {
    this.dialogRef?.close(result);
    this.sheetRef?.dismiss(result);
  }
}
