import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, form, submit, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { shortHash, VcsService } from '../../core/services/vcs.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ImportExportService } from '../../core/services/import-export.service';
import { type CommitRow } from './commit-history.model';
import { DiffViewer } from '../../shared/components/diff-viewer/diff-viewer';

/** Form model of the commit box. */
interface CommitMessageModel {
  message: string;
}

/** Serialized diff texts fed to the expanded row's DiffViewer. */
interface DiffTexts {
  oldText: string;
  newText: string;
}

/** Longest commit message the UI accepts. */
const MAX_COMMIT_MESSAGE = 200;

/** Right-hand drawer: commit box plus scrollable history with per-commit diffs. */
@Component({
  selector: 'app-commit-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    DiffViewer,
  ],
  templateUrl: './commit-history.html',
  styleUrl: './commit-history.scss',
})
export class CommitHistory {
  protected readonly workspace = inject(WorkspaceService);
  private readonly vcs = inject(VcsService);
  private readonly importer = inject(ImportExportService);

  private readonly messageModel = signal<CommitMessageModel>({ message: '' });

  protected readonly commitForm = form(this.messageModel, (s) => {
    validate(s.message, ({ value }) => {
      const text = value().trim();
      if (!text) {
        return { kind: 'required', message: 'A commit message is required' };
      }
      if (text.length > MAX_COMMIT_MESSAGE) {
        return {
          kind: 'maxlength',
          message: `Keep the message under ${MAX_COMMIT_MESSAGE} characters`,
        };
      }
      return undefined;
    });
  });

  protected readonly expanded = signal<string | null>(null);
  protected readonly committing = signal(false);

  protected readonly rows = computed<CommitRow[]>(() => {
    const project = this.workspace.activeProject();
    if (!project) {
      return [];
    }
    const byId = new Map(project.commits.map((c) => [c.id, c]));
    return [...project.commits].reverse().map((commit) => ({
      commit,
      parent: commit.parentId ? (byId.get(commit.parentId) ?? null) : null,
    }));
  });

  protected canCommit = computed(
    () => this.workspace.hasUnsavedChanges() && !this.committing() && this.commitForm().valid(),
  );

  protected async commit(): Promise<void> {
    if (this.committing()) {
      return;
    }
    await submit(this.commitForm, async () => {
      const text = this.messageModel().message.trim();
      this.committing.set(true);
      try {
        await this.workspace.commit(text);
        this.messageModel.set({ message: '' });
      } finally {
        this.committing.set(false);
      }
    });
  }

  protected async restore(row: CommitRow): Promise<void> {
    await this.workspace.rollbackTo(row.commit.id);
  }

  /** Downloads the full project (commits included) as a `.stproj` archive. */
  protected exportArchive(): void {
    const project = this.workspace.activeProject();
    if (project) {
      this.importer.exportProject(project);
    }
  }

  protected toggleDiff(id: string): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  /**
   * Snapshot texts of the expanded row, stringified here instead of in the
   * template so typing in the commit box never re-serializes full snapshots
   * (nor re-runs DiffViewer's diff on fresh strings). Recomputes only when
   * the commit history or the expanded commit changes.
   */
  protected readonly expandedDiff = computed<DiffTexts | null>(() => {
    const row = this.rows().find((r) => r.commit.id === this.expanded());
    if (!row) {
      return null;
    }
    return {
      oldText: row.parent ? JSON.stringify(row.parent.snapshot, null, 2) : '',
      newText: JSON.stringify(row.commit.snapshot, null, 2),
    };
  });

  protected hash(id: string): string {
    return shortHash(id);
  }

  /** Compact relative timestamp, e.g. "4m ago". */
  protected ago(timestamp: number): string {
    const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.round(hours / 24);
    if (days < 30) {
      return `${days}d ago`;
    }
    return new Date(timestamp).toLocaleDateString();
  }
}
