import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { formatTokenCount } from '../../../core/services/token-estimator';
import { WorkspaceService } from '../../../core/services/workspace.service';

/**
 * Breakdown of the always-active token footprint: every enabled + constant
 * entry with its estimated weight, the combined total against the book's
 * `token_budget` (editable inline), and quick navigation to the entries.
 */
@Component({
  selector: 'app-token-inspector-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './token-inspector-dialog.html',
  styleUrl: './token-inspector-dialog.scss',
})
export class TokenInspectorDialog {
  private readonly dialogRef = inject(MatDialogRef<TokenInspectorDialog, void>);
  protected readonly workspace = inject(WorkspaceService);

  protected readonly footprint = this.workspace.tokenFootprint;
  protected readonly formatTokens = formatTokenCount;

  /** Budget draft bound to the number field; null = no budget (empty input). */
  protected readonly budgetDraft = signal<number | null>(
    this.workspace.activeProject()?.activeBook.token_budget ?? null,
  );

  /**
   * Meter fill as a percentage (MatProgressBar's `value` is 0-100), clamped
   * so the over-budget case renders as a full bar rather than overflowing.
   */
  protected readonly meterValue = computed(() => {
    const fp = this.footprint();
    if (!fp || fp.usage === null) {
      return 0;
    }
    return Math.min(fp.usage, 1) * 100;
  });

  /** Whole-number budget usage percentage for the caption / aria labels. */
  protected readonly usagePercent = computed(() =>
    Math.round((this.footprint()?.usage ?? 0) * 100),
  );

  /** Tokens over a set budget, for the warning caption. */
  protected readonly overBy = computed(() => {
    const fp = this.footprint();
    return fp?.overBudget && fp.budget ? fp.totalTokens - fp.budget : 0;
  });

  protected onBudgetInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const parsed = raw === '' ? null : Math.floor(Number(raw));
    const budget = parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    this.budgetDraft.set(budget);
    this.workspace.updateBook({ token_budget: budget ?? undefined });
  }

  protected openEntry(entryId: number): void {
    this.workspace.openEntry(entryId);
    this.dialogRef.close();
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
