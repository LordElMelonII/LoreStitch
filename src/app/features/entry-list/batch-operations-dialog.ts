import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  type StLogic,
  type StRole,
  ST_ROLE,
  ST_ROLE_OPTIONS,
  type WiPosition,
  type WiTriggerState,
  ST_LOGIC_OPTIONS,
  WI_POSITION_OPTIONS,
  entryTags,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import {
  type BatchOperations,
  type PositionOperation,
  buildBatchPatch,
} from './batch-operations.model';

/** Payload handed to `BatchOperationsDialog`. */
export interface BatchOperationsDialogData {
  entryIds: number[];
}

/**
 * Bulk editor for the sidebar's selection: toggle enabled/constant, shift or
 * set insertion orders, standardize the evaluation strategy (scan depth,
 * case sensitivity, selective logic, position) and assign tags. Only fields
 * the operator explicitly changed are written (see `BatchOperations`).
 */
@Component({
  selector: 'app-batch-operations-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './batch-operations-dialog.html',
  styleUrl: './batch-operations-dialog.scss',
})
export class BatchOperationsDialog {
  private readonly dialogRef = inject(MatDialogRef<BatchOperationsDialog, boolean>);
  protected readonly data = inject<BatchOperationsDialogData>(MAT_DIALOG_DATA);
  private readonly workspace = inject(WorkspaceService);
  private readonly snackBar = inject(MatSnackBar);

  // Status ------------------------------------------------------------------
  protected readonly enabledMode = signal<'unchanged' | 'enable' | 'disable'>('unchanged');
  protected readonly triggerStateMode = signal<'unchanged' | WiTriggerState>('unchanged');

  // Insertion order ---------------------------------------------------------
  protected readonly orderMode = signal<'unchanged' | 'set' | 'shift'>('unchanged');
  protected readonly orderAmount = signal<number>(0);

  // Evaluation strategy -----------------------------------------------------
  protected readonly scanDepthMode = signal<'unchanged' | 'set' | 'clear'>('unchanged');
  protected readonly scanDepthValue = signal<number>(4);
  protected readonly caseMode = signal<'unchanged' | 'on' | 'off' | 'default'>('unchanged');
  protected readonly logicMode = signal<'unchanged' | 'set'>('unchanged');
  protected readonly logicValue = signal<StLogic>(0);
  protected readonly positionMode = signal<'unchanged' | 'set'>('unchanged');
  protected readonly positionValue = signal<WiPosition>('before_char');
  protected readonly depthValue = signal<number>(4);
  protected readonly roleValue = signal<StRole>(ST_ROLE.system);
  protected readonly outletName = signal<string>('');

  // Tags --------------------------------------------------------------------
  protected readonly addTagsDraft = signal<string>('');
  /** Tags the operator marks for removal, across the selection. */
  protected readonly removeTags = signal<ReadonlySet<string>>(new Set());

  protected readonly logicOptions = ST_LOGIC_OPTIONS;
  protected readonly positionOptions = WI_POSITION_OPTIONS;
  protected readonly roleOptions = ST_ROLE_OPTIONS;

  /** Existing tags across the whole selection (for the removal chips). */
  protected readonly existingTags = computed<string[]>(() => {
    const ids = new Set(this.data.entryIds);
    const tags = new Set<string>();
    for (const entry of this.workspace.entries()) {
      if (entry.id !== undefined && ids.has(entry.id)) {
        for (const tag of entryTags(entry)) {
          tags.add(tag);
        }
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  });

  /** The operations object implied by the current dialog state. */
  protected readonly operations = computed<BatchOperations>(() => {
    const ops: BatchOperations = {};
    if (this.enabledMode() !== 'unchanged') {
      ops.enabled = this.enabledMode() === 'enable';
    }
    const triggerStateMode = this.triggerStateMode();
    if (triggerStateMode !== 'unchanged') {
      ops.triggerState = triggerStateMode;
    }
    const orderMode = this.orderMode();
    if (orderMode !== 'unchanged') {
      ops.insertionOrder = {
        mode: orderMode,
        amount: this.sanitizeNumber(this.orderAmount(), 0),
      };
    }
    const scanDepthMode = this.scanDepthMode();
    if (scanDepthMode !== 'unchanged') {
      ops.scanDepth =
        scanDepthMode === 'clear'
          ? { mode: 'clear', value: 0 }
          : { mode: 'set', value: this.sanitizeNumber(this.scanDepthValue(), 4) };
    }
    if (this.caseMode() !== 'unchanged') {
      ops.caseSensitive =
        this.caseMode() === 'on' ? true : this.caseMode() === 'off' ? false : null;
    }
    if (this.logicMode() === 'set') {
      ops.selectiveLogic = this.logicValue();
    }
    if (this.positionMode() === 'set') {
      const position: PositionOperation = { position: this.positionValue() };
      if (position.position === 'at_depth') {
        position.depth = this.sanitizeNumber(this.depthValue(), 4);
        position.role = this.roleValue();
      }
      if (position.position === 'outlet') {
        position.outletName = this.outletName();
      }
      ops.position = position;
    }
    const addTags = this.parseTagDraft();
    const removeTags = [...this.removeTags()];
    if (addTags.length) {
      ops.addTags = addTags;
    }
    if (removeTags.length) {
      ops.removeTags = removeTags;
    }
    return ops;
  });

  /** How many selected entries would actually change — drives the apply button. */
  protected readonly affectedCount = computed(() => {
    const ops = this.operations();
    const ids = new Set(this.data.entryIds);
    return this.workspace
      .entries()
      .filter((entry) => entry.id !== undefined && ids.has(entry.id))
      .filter((entry) => buildBatchPatch(entry, ops) !== null).length;
  });

  protected readonly removalChips = computed(() =>
    this.existingTags().map((tag) => ({ tag, marked: this.removeTags().has(tag) })),
  );

  protected toggleRemoveTag(tag: string): void {
    this.removeTags.update((current) => {
      const next = new Set(current);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  protected apply(): void {
    const ops = this.operations();
    const count = this.affectedCount();
    if (count === 0) {
      this.dialogRef.close(false);
      return;
    }
    this.workspace.updateManyEntries(
      this.data.entryIds,
      (entry) => buildBatchPatch(entry, ops) ?? {},
    );
    this.snackBar.open(`Updated ${count} entr${count === 1 ? 'y' : 'ies'}.`, 'OK', {
      duration: 3500,
    });
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  /** Comma-separated tag draft -> trimmed, de-duplicated tag list. */
  private parseTagDraft(): string[] {
    return [
      ...new Set(
        this.addTagsDraft()
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
  }

  private sanitizeNumber(raw: number, fallback: number): number {
    return Number.isFinite(raw) ? Math.floor(raw) : fallback;
  }
}
