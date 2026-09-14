import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, form, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { ProjectWorkspace } from '../../core/models/lorebook.model';
import { type NewProjectResult } from './new-project.model';

/** Form model of the new-project dialog. */
interface NewProjectFormModel {
  title: string;
  targetType: ProjectWorkspace['targetType'];
}

/** Longest project title the UI accepts. */
const MAX_PROJECT_TITLE = 80;

/** Dialog for creating a fresh project (title + target type). */
@Component({
  selector: 'app-new-project-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
  ],
  template: `
    <h2 mat-dialog-title>New Project</h2>
    <mat-dialog-content class="body">
      <mat-form-field class="title-field" subscriptSizing="dynamic">
        <mat-label>Project title</mat-label>
        <input
          matInput
          [formField]="projectForm.title"
          placeholder="e.g. Fuyuki City Lorebook"
          aria-label="Project title"
          (keydown.enter)="create()"
        />
        @if (projectForm.title().touched() && projectForm.title().errors()[0]; as error) {
          <mat-error>{{ error.message }}</mat-error>
        }
      </mat-form-field>

      <mat-radio-group
        class="type-group"
        [value]="targetType()"
        (change)="setTargetType($event.value)"
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
      <button matButton="filled" type="button" (click)="create()" [disabled]="projectForm().invalid()">
        Create Project
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .body {
      display: flex;
      flex-direction: column;
      padding: 20px 24px;
      gap: 24px;
      // Fits phones: never wider than the viewport minus dialog margins.
      width: min(420px, calc(100vw - 48px));
    }

    .title-field {
      padding-top: 8px;
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

  private readonly model = signal<NewProjectFormModel>({
    title: '',
    targetType: 'standalone_lorebook',
  });

  protected readonly projectForm = form(this.model, (s) => {
    validate(s.title, ({ value }) => {
      const title = value().trim();
      if (!title) {
        return { kind: 'required', message: 'A project title is required' };
      }
      if (title.length > MAX_PROJECT_TITLE) {
        return {
          kind: 'maxlength',
          message: `Keep the title under ${MAX_PROJECT_TITLE} characters`,
        };
      }
      return undefined;
    });
  });

  protected readonly targetType = computed(() => this.model().targetType);

  /** The radio group is a Material (CVA) control, so it writes to the model. */
  protected setTargetType(value: ProjectWorkspace['targetType']): void {
    this.model.update((m) => ({ ...m, targetType: value }));
  }

  protected create(): void {
    void submit(this.projectForm, async () => {
      this.ref.close({
        title: this.model().title.trim(),
        targetType: this.model().targetType,
      });
    });
  }
}
