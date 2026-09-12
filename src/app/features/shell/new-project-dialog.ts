import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { ProjectWorkspace } from '../../core/models/lorebook.model';

export interface NewProjectResult {
  title: string;
  targetType: ProjectWorkspace['targetType'];
}

/** Dialog for creating a fresh project (title + target type). */
@Component({
  selector: 'app-new-project-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>New Project</h2>
    <mat-dialog-content class="body">
      <mat-form-field class="title-field" subscriptSizing="dynamic">
        <mat-label>Project title</mat-label>
        <input
          matInput
          [value]="title()"
          (input)="title.set($any($event.target).value)"
          placeholder="e.g. Fuyuki City Lorebook"
          aria-label="Project title"
          (keydown.enter)="create()"
        />
      </mat-form-field>

      <mat-radio-group
        class="type-group"
        [value]="targetType()"
        (change)="targetType.set($event.value)"
      >
        <mat-radio-button value="standalone_lorebook">
          <span class="radio-main">Standalone Lorebook</span>
          <span class="radio-hint">A world-info book exported as plain JSON</span>
        </mat-radio-button>
        <mat-radio-button value="tavern_card_v2">
          <span class="radio-main">Tavern Card V2</span>
          <span class="radio-hint">A character card with an embedded book</span>
        </mat-radio-button>
      </mat-radio-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" (click)="ref.close(null)">Cancel</button>
      <button matButton="filled" type="button" (click)="create()" [disabled]="!title().trim()">
        Create Project
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .body {
      display: flex;
      flex-direction: column;
      gap: 16px;
      // Fits phones: never wider than the viewport minus dialog margins.
      width: min(420px, calc(100vw - 48px));
    }

    .title-field {
      width: 100%;
    }

    .type-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .radio-main {
      font: var(--mat-sys-body-large);
    }

    .radio-hint {
      display: block;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class NewProjectDialog {
  protected readonly ref = inject(MatDialogRef<NewProjectDialog, NewProjectResult | null>);

  protected readonly title = signal('');
  protected readonly targetType = signal<ProjectWorkspace['targetType']>('standalone_lorebook');

  protected create(): void {
    const title = this.title().trim();
    if (!title) {
      return;
    }
    this.ref.close({ title, targetType: this.targetType() });
  }
}
