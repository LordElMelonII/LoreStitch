import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { formatTokenCount } from '../../../core/services/token-estimator';

/**
 * The top-bar "Always Active Token Footprint" meter: the aggregate token
 * estimate of every enabled + constant entry — the context weight a chat
 * carries before its first message — shown against the book's budget when
 * one is set. Clicking opens the token inspector for the per-entry breakdown.
 */
@Component({
  selector: 'app-token-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @if (footprint(); as fp) {
      <button
        matButton
        type="button"
        class="token-meter"
        [class.over-budget]="fp.overBudget"
        (click)="openInspector()"
        [matTooltip]="tooltip()"
        aria-label="Always active token footprint — open token inspector"
      >
        <mat-icon [class.warn-icon]="fp.overBudget">bolt</mat-icon>
        <span class="meter-label">~{{ formatTokens(fp.totalTokens) }}</span>
        @if (fp.overBudget) {
          <mat-icon class="warn-icon" aria-hidden="true">priority_high</mat-icon>
        }
      </button>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .token-meter {
      // Compact pill: icon plus the short token label; the label collapses on
      // narrow viewports where the top bar only fits icon-sized actions.
      gap: 4px;
      padding-inline: 10px;
      min-width: 0;
      font: var(--mat-sys-label-medium);

      .meter-label {
        white-space: nowrap;
      }

      &.over-budget {
        color: var(--mat-sys-error);
        background: color-mix(in srgb, var(--mat-sys-error-container) 55%, transparent);
      }

      .warn-icon {
        color: var(--mat-sys-error);
      }
    }

    @media (max-width: 767px) {
      .token-meter {
        padding-inline: 0;
        // Icon-only collapse must still meet the 48px touch-target floor.
        min-width: 48px;
        .meter-label {
          display: none;
        }
      }
    }
  `,
})
export class TokenMeter {
  private readonly dialog = inject(MatDialog);
  protected readonly workspace = inject(WorkspaceService);

  protected readonly footprint = this.workspace.tokenFootprint;

  protected readonly tooltip = computed<string>(() => {
    const fp = this.footprint();
    if (!fp) {
      return '';
    }
    const base =
      `Always active: ~${fp.totalTokens.toLocaleString()} tokens across ` +
      `${fp.constantCount} constant entr${fp.constantCount === 1 ? 'y' : 'ies'}`;
    const budget = fp.budget
      ? ` of ${fp.budget.toLocaleString()} budget (${Math.round((fp.usage ?? 0) * 100)}%)`
      : '';
    const over = fp.overBudget ? ' — over budget!' : '';
    return `${base}${budget}${over}. Click to inspect.`;
  });

  protected formatTokens(tokens: number): string {
    return formatTokenCount(tokens);
  }

  protected async openInspector(): Promise<void> {
    // Lazy-loaded: keeps the inspector out of the initial bundle.
    const { TokenInspectorDialog } = await import('./token-inspector-dialog');
    this.dialog.open(TokenInspectorDialog, {
      width: '100%',
      maxWidth: 'min(96vw, 560px)',
      // MD3 adaptive behavior: the dialog goes full-screen on compact screens
      // (see the global .app-compact-fullscreen-dialog rules). The inspector
      // class additionally lifts the 65vh content cap so the pane sizes to
      // its content — only the entry list scrolls, never the whole dialog.
      panelClass: ['app-compact-fullscreen-dialog', 'app-token-inspector-dialog'],
    });
  }
}
