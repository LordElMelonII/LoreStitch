import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProjectCommit } from '../../core/models/lorebook.model';
import { shortHash, VcsService } from '../../core/services/vcs.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { DiffViewer } from '../../shared/components/diff-viewer/diff-viewer';

interface CommitRow {
  commit: ProjectCommit;
  parent: ProjectCommit | null;
}

/** Right-hand drawer: commit box plus scrollable history with per-commit diffs. */
@Component({
  selector: 'app-commit-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
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

  protected readonly message = signal('');
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

  protected canCommit = computed(() => {
    const message = this.message().trim();
    return this.workspace.hasUnsavedChanges() && message.length > 0 && !this.committing();
  });

  protected onMessageInput(event: Event): void {
    this.message.set((event.target as HTMLInputElement).value);
  }

  protected async commit(): Promise<void> {
    const text = this.message().trim();
    if (!text || this.committing()) {
      return;
    }
    this.committing.set(true);
    try {
      await this.workspace.commit(text);
      this.message.set('');
    } finally {
      this.committing.set(false);
    }
  }

  protected async restore(row: CommitRow): Promise<void> {
    await this.workspace.rollbackTo(row.commit.id);
  }

  protected toggleDiff(id: string): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  protected snapshotText(row: CommitRow): string {
    return JSON.stringify(row.commit.snapshot, null, 2);
  }

  protected parentText(row: CommitRow): string {
    return row.parent ? JSON.stringify(row.parent.snapshot, null, 2) : '';
  }

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
