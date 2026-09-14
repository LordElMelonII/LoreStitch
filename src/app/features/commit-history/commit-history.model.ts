import type { ProjectCommit } from '../../core/models/lorebook.model';

/** One rendered history row: the commit plus its (optional) parent for diffs. */
export interface CommitRow {
  commit: ProjectCommit;
  parent: ProjectCommit | null;
}
