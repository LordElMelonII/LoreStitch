import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { formatTokenCount } from '../../../core/services/token-estimator';
import { LayoutService } from '../../../shared/services/layout.service';

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
      @if (!isMobile()) {
        <!-- Desktop + tablet (>= 768px): labeled pill with token count -->
        <button
          matButton
          type="button"
          class="token-meter token-meter-pill"
          [class.has-budget]="hasBudget()"
          [class.near-budget]="isNearBudget()"
          [class.over-budget]="fp.overBudget"
          [style.--meter-fill]="fillPercentage() + '%'"
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
      } @else {
        <!-- Phones (< 768px): circular icon button -->
        <button
          matIconButton
          type="button"
          class="token-meter token-meter-icon"
          [class.has-budget]="hasBudget()"
          [class.near-budget]="isNearBudget()"
          [class.over-budget]="fp.overBudget"
          [style.--meter-fill]="fillPercentage() + '%'"
          (click)="openInspector()"
          [matTooltip]="tooltip()"
          aria-label="Always active token footprint — open token inspector"
        >
          <mat-icon [class.warn-icon]="fp.overBudget">bolt</mat-icon>
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    // Shared battery meter & fill styles
    .token-meter {
      position: relative;
      overflow: hidden;
      isolation: isolate;

      // Track / Battery casing
      &.has-budget {
        background: color-mix(in srgb, var(--mat-sys-on-surface) 6%, transparent);
        outline: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 45%, transparent);
        outline-offset: -1px;
      }

      // Battery progressive fill
      &::before {
        content: '';
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        width: var(--meter-fill, 0%);
        background: var(
          --meter-fill-color,
          color-mix(in srgb, var(--mat-sys-primary) 20%, transparent)
        );
        border-radius: inherit;
        pointer-events: none;
        z-index: -1;
        transition:
          width 250ms cubic-bezier(0.4, 0, 0.2, 1),
          background-color 250ms ease;
      }

      // Warning tier when reaching 85%+ capacity
      &.near-budget:not(.over-budget) {
        --meter-fill-color: color-mix(in srgb, var(--mat-sys-tertiary-container) 75%, transparent);
      }

      // Over budget: full red bar & error accents
      &.over-budget {
        color: var(--mat-sys-error);
        --meter-fill-color: color-mix(in srgb, var(--mat-sys-error-container) 70%, transparent);
        outline-color: color-mix(in srgb, var(--mat-sys-error) 40%, transparent);

        .warn-icon {
          color: var(--mat-sys-error);
        }
      }
    }

    // Labeled pill layout (desktop + tablet, >= 768px)
    .token-meter-pill {
      gap: 4px;
      padding-inline: 10px;
      min-width: 0;
      font: var(--mat-sys-label-medium);

      .meter-label {
        white-space: nowrap;
      }
    }

    // Phone-only circular button (clean centering and a circular track).
    // The icon-only collapse serves the shell's mobile class (< 768px) and
    // must still meet the 48px touch-target floor (the old icon-collapse
    // precedent), so the state-layer size is floored here: Material's
    // width, height and padding all read this token.
    .token-meter-icon {
      --mat-icon-button-state-layer-size: 48px;
      border-radius: 50%;

      // Keep the icon flush inside the circular track without !important:
      // the topbar never renders inside a form-field suffix, where Material
      // centers icon-button icons with margin auto.
      mat-icon {
        margin: 0;
      }
    }
  `,
})
export class TokenMeter {
  private readonly dialog = inject(MatDialog);
  protected readonly workspace = inject(WorkspaceService);
  protected readonly isMobile = inject(LayoutService).isMobile;

  protected readonly footprint = this.workspace.tokenFootprint;

  protected readonly hasBudget = computed<boolean>(() => {
    return Boolean(this.footprint()?.budget);
  });

  protected readonly fillPercentage = computed<number>(() => {
    const fp = this.footprint();
    if (!fp?.budget) {
      return 0;
    }
    if (fp.overBudget) {
      return 100;
    }
    return Math.min(Math.max((fp.usage ?? 0) * 100, 0), 100);
  });

  protected readonly isNearBudget = computed<boolean>(() => {
    const fp = this.footprint();
    return Boolean(fp?.budget && !fp.overBudget && (fp.usage ?? 0) >= 0.85);
  });

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
    const { TokenInspectorDialog } = await import('./token-inspector-dialog');
    this.dialog.open(TokenInspectorDialog, {
      width: '100%',
      maxWidth: 'min(96vw, 560px)',
      panelClass: ['app-compact-fullscreen-dialog', 'app-token-inspector-dialog'],
    });
  }
}
