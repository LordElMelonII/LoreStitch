import { TestBed } from '@angular/core/testing';
import { createEmptyBook, createEmptyEntry } from '../../../core/models/lorebook.model';
import { ProjectWorkspace } from '../../../core/models/project.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ProjectActionsService } from '../project-actions.service';
import { WelcomeScreen } from './welcome-screen';

function savedProject(id: string, title: string, entryCount: number): ProjectWorkspace {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: {
      ...createEmptyBook(title),
      entries: Array.from({ length: entryCount }, (_, i) => createEmptyEntry(i)),
    },
    headCommitId: null,
    commits: [],
  };
}

describe('WelcomeScreen', () => {
  let workspace: WorkspaceService;
  let actions: ProjectActionsService;

  async function createScreen(): Promise<{
    component: WelcomeScreen;
    element: HTMLElement;
  }> {
    const fixture = TestBed.createComponent(WelcomeScreen);
    await fixture.whenStable();
    fixture.detectChanges();
    return { component: fixture.componentInstance, element: fixture.nativeElement };
  }

  beforeEach(async () => {
    // CDK BreakpointObserver (via ProjectActionsService) needs matchMedia.
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }),
      });
    }
    TestBed.configureTestingModule({ imports: [WelcomeScreen] });
    workspace = TestBed.inject(WorkspaceService);
    actions = TestBed.inject(ProjectActionsService);
    // Allow the workspace's async init() to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('renders the brand headline and primary actions', async () => {
    const { element } = await createScreen();

    expect(element.querySelector('h1')?.textContent).toContain('LoreStitch');
    expect(element.textContent).toContain('Offline studio for SillyTavern lorebooks');
    const [newProject, importFile] = element.querySelectorAll('.welcome-actions button');
    expect(newProject?.textContent).toContain('New project');
    expect(importFile?.textContent).toContain('Import');
  });

  it('hides the recent list when nothing is saved', async () => {
    const { element } = await createScreen();

    expect(element.querySelector('.recent')).toBeNull();
  });

  it('lists recent projects with their entry counts', async () => {
    workspace.savedProjects.set([
      savedProject('p1', 'Fuyuki', 3),
      savedProject('p2', 'Fate', 7),
    ]);
    const { element } = await createScreen();

    const items = [...element.querySelectorAll('.recent-item')];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Fuyuki');
    expect(items[0]?.querySelector('.recent-count')?.textContent).toContain('3 entries');
    expect(items[1]?.textContent).toContain('Fate');
    expect(items[0]?.getAttribute('aria-label')).toBe('Open project Fuyuki');
  });

  it('opens a recent project on click and on Enter', async () => {
    workspace.savedProjects.set([savedProject('p1', 'Fuyuki', 3)]);
    const openSpy = vi.spyOn(actions, 'openProject').mockResolvedValue(undefined);
    const { element } = await createScreen();

    // Both activation paths route through the same open handler.
    const item = element.querySelector<HTMLElement>('.recent-item');
    assert(item);
    item.dispatchEvent(new Event('click'));
    expect(openSpy).toHaveBeenCalledWith('p1');

    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(openSpy).toHaveBeenCalledTimes(2);
    expect(openSpy).toHaveBeenLastCalledWith('p1');
  });

  it('deletes a project from the row without opening it', async () => {
    workspace.savedProjects.set([savedProject('p1', 'Fuyuki', 3)]);
    const deleteSpy = vi.spyOn(actions, 'deleteProject').mockResolvedValue(undefined);
    const openSpy = vi.spyOn(actions, 'openProject').mockResolvedValue(undefined);
    const { element } = await createScreen();

    const item = element.querySelector<HTMLElement>('.recent-item');
    assert(item);
    let propagated = false;
    item.addEventListener('click', () => (propagated = true));
    item.querySelector<HTMLButtonElement>('.recent-delete')?.click();

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0]?.[0]?.id).toBe('p1');
    // stopPropagation keeps the row's own open action silent.
    expect(propagated).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
