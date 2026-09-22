import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProjectWorkspace } from '../../../core/models/project.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ProjectActionsService } from '../project-actions.service';

/** Empty-state screen shown when no project is open. */
@Component({
  selector: 'app-welcome-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatListModule, MatTooltipModule],
  templateUrl: './welcome-screen.html',
  styleUrl: './welcome-screen.scss',
})
export class WelcomeScreen {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly actions = inject(ProjectActionsService);

  protected async delete(project: ProjectWorkspace, event: Event): Promise<void> {
    event.stopPropagation();
    await this.actions.deleteProject(project);
  }
}
