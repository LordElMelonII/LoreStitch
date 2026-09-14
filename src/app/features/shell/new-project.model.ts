import type { ProjectWorkspace } from '../../core/models/lorebook.model';

/** Result of `NewProjectDialog` (null when cancelled). */
export interface NewProjectResult {
  title: string;
  targetType: ProjectWorkspace['targetType'];
}
