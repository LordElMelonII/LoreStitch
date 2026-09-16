import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormField, form, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { type NewProjectResult } from './new-project.model';

/** Form model of the new-project dialog. */
interface NewProjectFormModel {
  title: string;
}

/** Longest project title the UI accepts. */
const MAX_PROJECT_TITLE = 80;

/** Dialog for creating a fresh project (title). */
@Component({
  selector: 'app-new-project-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>New Project</h2>
    <mat-dialog-content class="body">
      <mat-form-field class="title-field" subscriptSizing="dynamic" appearance="fill">
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
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" (click)="ref.close(null)">Cancel</button>
      <button
        matButton="filled"
        type="button"
        (click)="create()"
        [disabled]="projectForm().invalid()"
      >
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
    }

    .title-field {
      padding-top: 8px;
      width: 100%;
    }
  `,
})
export class NewProjectDialog {
  protected readonly ref = inject(MatDialogRef<NewProjectDialog, NewProjectResult | null>);

  private readonly model = signal<NewProjectFormModel>({ title: '' });

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

  protected create(): void {
    void submit(this.projectForm, async () => {
      this.ref.close({ title: this.model().title.trim() });
    });
  }
}
