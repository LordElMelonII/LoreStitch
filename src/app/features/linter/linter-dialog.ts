import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { entryTitle } from '../../core/models/lorebook.model';
import { LintDiagnostic, LintRuleId, LintSeverity } from '../../core/services/linter';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LinterState } from './linter-state';

/** Humanized mute-chip labels (plan 03 §3.6.5.3) — exhaustive per rule id. */
const RULE_LABELS: Record<LintRuleId, string> = {
  'invalid-regex': 'Invalid regex',
  'duplicate-key': 'Duplicate keys',
  'secondary-keys-ignored': 'Ignored secondary keys',
  'selective-without-secondary': 'Selective without secondary',
  'never-activatable': 'Never activatable',
  'recursion-cycle': 'Recursion cycles',
  'self-trigger': 'Self-triggers',
  'malformed-wrapper': 'Malformed wrappers',
};

/** Section nouns match the summary slots; the `info` noun is Notes everywhere. */
const SEVERITY_HEADINGS: Record<LintSeverity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Notes',
};

const SEVERITY_ICONS: Record<LintSeverity, string> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

/** One entry-title jump target, resolved once so the template stays index-free. */
interface EntryJump {
  readonly entryId: number;
  readonly title: string;
  readonly ariaLabel: string;
}

/**
 * View model of one diagnostic row (plan 03 §3.6.4). The core's `message`
 * renders verbatim; the entry titles resolve here so the template never
 * indexes into arrays (strict `noUncheckedIndexedAccess`).
 */
interface DiagnosticRow {
  readonly diagnostic: LintDiagnostic;
  /** Multi-entry rows: one named stroked jump button per entry (amended R1). */
  readonly jumps: readonly EntryJump[];
  /** Single-entry rows: decorative title chip (null on multi/zero rows). */
  readonly singleTitle: string | null;
  /** Single-entry rows: the trailing Go-to action (null otherwise). */
  readonly goto: { readonly entryId: number; readonly ariaLabel: string } | null;
}

/** One severity section; empty sections never render. */
interface LintSection {
  readonly severity: LintSeverity;
  readonly heading: string;
  readonly icon: string;
  readonly rows: readonly DiagnosticRow[];
}

/**
 * One mute chip (§3.6.5.3): the entry editor's filter-chip pattern —
 * selected (filled + check) means the check runs, deselected (outlined)
 * means muted. Muted chips stay visible so they can be re-enabled.
 */
interface MuteChip {
  readonly rule: LintRuleId;
  readonly label: string;
  readonly muted: boolean;
}

/**
 * Lorebook health check pane (plan 03 §3.6.2/§3.6.4): centered dialog on
 * tablet/desktop, bottom sheet on phones — the same component inside whichever
 * container `ResponsiveOverlayService` chose, so both refs are optional and
 * dismissal goes to the live one (the About exemplar). The pane renders
 * `LinterState.diagnostics` live: there is no refresh control, the re-run is
 * automatic whenever the project signal changes. The linter only diagnoses —
 * rows offer jump (and the §3.6.5 not-an-issue/mute affordances), never "Fix".
 */
@Component({
  selector: 'app-linter-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatChipsModule, MatIconModule, MatTooltipModule],
  templateUrl: './linter-dialog.html',
  styleUrl: './linter-dialog.scss',
})
export class LinterDialog {
  private readonly dialogRef = inject(MatDialogRef, { optional: true });
  private readonly sheetRef = inject(MatBottomSheetRef, { optional: true });

  protected readonly linter = inject(LinterState);
  private readonly workspace = inject(WorkspaceService);

  /** Sections in the fixed Errors → Warnings → Notes order; empty ones absent. */
  protected readonly sections = computed<readonly LintSection[]>(() => {
    const diagnostics = this.linter.diagnostics();
    return (['error', 'warning', 'info'] as const)
      .map((severity) => ({
        severity,
        heading: SEVERITY_HEADINGS[severity],
        icon: SEVERITY_ICONS[severity],
        rows: diagnostics
          .filter((diagnostic) => diagnostic.severity === severity)
          .map((diagnostic) => this.rowOf(diagnostic)),
      }))
      .filter((section) => section.rows.length > 0);
  });

  /** `N errors · N warnings · N notes` — pluralized, all three counts always shown. */
  protected readonly summary = computed(() => {
    const diagnostics = this.linter.diagnostics();
    const count = (severity: LintSeverity) =>
      diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
    const errors = count('error');
    const warnings = count('warning');
    const notes = count('info');
    return `${errors} ${errors === 1 ? 'error' : 'errors'} · ${warnings} ${
      warnings === 1 ? 'warning' : 'warnings'
    } · ${notes} ${notes === 1 ? 'note' : 'notes'}`;
  });

  /**
   * One chip per rule present in the unfiltered pass (§3.6.5.3), muted ones
   * included so they can be re-enabled. Order follows the pass itself
   * (severity → entry order), deterministic for the same book.
   */
  protected readonly muteChips = computed<readonly MuteChip[]>(() => {
    const muted = this.linter.mutedRules();
    return [...this.linter.unfilteredRules()].map((rule) => ({
      rule,
      label: RULE_LABELS[rule],
      muted: muted.has(rule),
    }));
  });

  protected goToEntry(entryId: number): void {
    // No-ops safely for unknown ids (workspace.service.ts) — then the pane
    // closes either way, matching the jump contract.
    this.workspace.openEntry(entryId);
    this.close();
  }

  /** Dismisses whichever container ref is live (the About close shape). */
  protected close(): void {
    this.dialogRef?.close();
    this.sheetRef?.dismiss();
  }

  private rowOf(diagnostic: LintDiagnostic): DiagnosticRow {
    const jumps = diagnostic.entryIds.map((entryId) => {
      const title = this.titleOf(entryId);
      return { entryId, title, ariaLabel: `Go to entry ${title}` };
    });
    const single = jumps.length === 1 ? jumps[0] : undefined;
    return {
      diagnostic,
      jumps: jumps.length > 1 ? jumps : [],
      singleTitle: single?.title ?? null,
      goto: single ? { entryId: single.entryId, ariaLabel: `Go to entry: ${single.title}` } : null,
    };
  }

  /** `entryTitle()` for a diagnostic member, falling back to the bare id. */
  private titleOf(entryId: number): string {
    const entry = this.workspace.entries().find((candidate) => candidate.id === entryId);
    return entry ? entryTitle(entry) : `Entry ${entryId}`;
  }
}
