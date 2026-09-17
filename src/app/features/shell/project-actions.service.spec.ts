import { TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { ImportExportService } from '../../core/services/import-export.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ProjectActionsService } from './project-actions.service';

/**
 * Replaces `document.createElement` so the private file picker resolves a
 * canned `File` (or a user cancellation) instead of opening a real dialog.
 */
function stubFilePicker(file: File | null): void {
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    ((tag: string, options?: ElementCreationOptions) => {
      if (tag !== 'input') {
        return realCreateElement(tag, options);
      }
      const listeners: Record<string, (() => void)[]> = {};
      const input = {
        type: '',
        accept: '',
        files: file ? [file] : [],
        addEventListener: (type: string, cb: () => void) => {
          (listeners[type] ??= []).push(cb);
        },
        click: () => {
          for (const cb of listeners[file ? 'change' : 'cancel'] ?? []) {
            cb();
          }
        },
      };
      return input as unknown as HTMLInputElement;
    }) as typeof document.createElement,
  );
}

function jsonFile(name: string, data: unknown): File {
  return new File([JSON.stringify(data)], name, { type: 'application/json' });
}

describe('ProjectActionsService', () => {
  let workspace: WorkspaceService;
  let importer: ImportExportService;
  let actions: ProjectActionsService;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let snackBarOpen: ReturnType<typeof vi.fn>;
  let isMatched: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dialogOpen = vi.fn().mockReturnValue({ afterClosed: () => of(undefined) });
    snackBarOpen = vi.fn();
    isMatched = vi.fn().mockReturnValue(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: MatSnackBar, useValue: { open: snackBarOpen } },
        { provide: BreakpointObserver, useValue: { isMatched } },
      ],
    });
    workspace = TestBed.inject(WorkspaceService);
    importer = TestBed.inject(ImportExportService);
    actions = TestBed.inject(ProjectActionsService);
    // Allow the workspace's async init() to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Project lifecycle
  // ---------------------------------------------------------------------------

  it('creates a project from the new-project dialog result', async () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of({ title: 'Fuyuki' }) });

    await actions.newProject();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(workspace.activeProject()?.title).toBe('Fuyuki');
  });

  it('creates nothing when the new-project dialog is dismissed', async () => {
    await actions.newProject();

    expect(workspace.activeProject()).toBeNull();
  });

  it('reopens a saved project by id', async () => {
    await workspace.createProject('Fuyuki');
    const created = workspace.activeProject();
    assert(created);
    const id = created.id;
    await workspace.closeProject();
    expect(workspace.activeProject()).toBeNull();

    await actions.openProject(id);

    expect(workspace.activeProject()?.title).toBe('Fuyuki');
  });

  it('closes the project and clears editor tabs', async () => {
    await workspace.createProject('Fuyuki');
    workspace.addEntry();

    await actions.closeProject();

    expect(workspace.activeProject()).toBeNull();
    expect(workspace.openTabEntryIds()).toEqual([]);
    expect(workspace.activeTabId()).toBeNull();
  });

  it('deletes a project after confirmation', async () => {
    await workspace.createProject('Doomed');
    const project = workspace.activeProject();
    assert(project);
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });

    await actions.deleteProject(project);

    expect(workspace.savedProjects()).toHaveLength(0);
    expect(workspace.activeProject()).toBeNull();
    const [, options] = dialogOpen.mock.calls[0] as unknown as [
      unknown,
      { data: { title: string; danger: boolean; message: string } },
    ];
    expect(options.data.title).toBe('Delete project');
    expect(options.data.danger).toBe(true);
    expect(options.data.message).toContain('Doomed');
  });

  it('keeps the project when the delete confirmation is dismissed', async () => {
    await workspace.createProject('Kept');
    const project = workspace.activeProject();
    assert(project);

    await actions.deleteProject(project);

    expect(workspace.savedProjects()).toHaveLength(1);
    expect(workspace.activeProject()?.title).toBe('Kept');
  });

  it('deletes the active project through deleteCurrentProject', async () => {
    await workspace.createProject('Doomed');
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });

    await actions.deleteCurrentProject();

    expect(workspace.activeProject()).toBeNull();
  });

  it('opens no confirm dialog when no project is active', async () => {
    await actions.deleteCurrentProject();

    expect(dialogOpen).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Import (replace)
  // ---------------------------------------------------------------------------

  it('does nothing when the file picker is cancelled', async () => {
    stubFilePicker(null);

    await actions.importReplaceFromPicker();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(workspace.activeProject()).toBeNull();
    expect(snackBarOpen).not.toHaveBeenCalled();
  });

  it('imports a .stproj archive as a full workspace', async () => {
    await workspace.createProject('Archived');
    const created = workspace.activeProject();
    assert(created);
    const archived = structuredClone(created) as unknown as Record<string, unknown>;
    await workspace.closeProject();
    stubFilePicker(
      jsonFile('backup.stproj', {
        format: 'lorestitch-project',
        version: 1,
        workspace: archived,
      }),
    );

    await actions.importReplaceFromPicker();

    expect(workspace.activeProject()?.title).toBe('Archived');
    expect(snackBarOpen).toHaveBeenCalledWith(
      expect.stringContaining('Opened project “Archived”'),
      'OK',
      expect.anything(),
    );
  });

  it('imports a native SillyTavern world-info file as a new project', async () => {
    stubFilePicker(
      jsonFile('fate.json', {
        entries: {
          '0': { uid: 0, key: ['saber'], content: 'King of Knights.', comment: 'Saber' },
        },
      }),
    );

    await actions.importReplaceFromPicker();

    const project = workspace.activeProject();
    expect(project?.activeBook.entries).toHaveLength(1);
    expect(project?.activeBook.entries[0]?.keys).toEqual(['saber']);
    expect(snackBarOpen).toHaveBeenCalledWith(
      expect.stringContaining('Imported 1 entries from fate.json'),
      'OK',
      expect.anything(),
    );
  });

  it('shows a parse error for a non-JSON file', async () => {
    stubFilePicker(new File(['this is not json'], 'broken.json'));

    await actions.importReplaceFromPicker();

    expect(workspace.activeProject()).toBeNull();
    expect(snackBarOpen).toHaveBeenCalledWith(
      expect.stringContaining('Could not parse this file as JSON.'),
      'OK',
      expect.anything(),
    );
  });

  it('shows an unsupported-format error for unrecognized JSON', async () => {
    stubFilePicker(jsonFile('mystery.json', { something: 'else' }));

    await actions.importReplaceFromPicker();

    expect(workspace.activeProject()).toBeNull();
    expect(snackBarOpen).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported format'),
      'OK',
      expect.anything(),
    );
  });

  // ---------------------------------------------------------------------------
  // Import (merge)
  // ---------------------------------------------------------------------------

  it('refuses merging when no project is open', async () => {
    stubFilePicker(jsonFile('book.json', { entries: [] }));

    await actions.importMergeFromPicker();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(snackBarOpen).toHaveBeenCalledWith(
      expect.stringContaining('Create or open a project before merging into it.'),
      'OK',
      expect.anything(),
    );
  });

  it('opens the merge resolver with the incoming book (desktop split mode)', async () => {
    await workspace.createProject('Fuyuki');
    const incoming = { entries: { '0': { uid: 0, key: ['rin'], content: 'Tohsaka.' } } };
    stubFilePicker(jsonFile('rin.json', incoming));
    dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });

    await actions.importMergeFromPicker();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    const [ , options] = dialogOpen.mock.calls[0] as unknown as [
      unknown,
      { data: { sourceName: string; mode: string } },
    ];
    expect(options.data.sourceName).toBe('rin.json');
    expect(options.data.mode).toBe('split');
    expect(isMatched).toHaveBeenCalled();
  });

  it('passes unified merge mode on mobile viewports', async () => {
    await workspace.createProject('Fuyuki');
    isMatched.mockReturnValue(true);
    stubFilePicker(jsonFile('book.json', { entries: {} }));
    dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });

    await actions.importMergeFromPicker();

    const [ , options] = dialogOpen.mock.calls[0] as unknown as [
      unknown,
      { data: { mode: string } },
    ];
    expect(options.data.mode).toBe('unified');
  });

  it('applies the merge outcome to the active book', async () => {
    await workspace.createProject('Fuyuki');
    workspace.addEntry();
    const entry = workspace.activeProject()?.activeBook.entries[0];
    assert(entry);
    const localId = entry.id;
    stubFilePicker(
      jsonFile('book.json', {
        entries: { '7': { uid: 7, key: ['rin'], content: 'Tohsaka Rin.' } },
      }),
    );
    dialogOpen.mockImplementation(() => {
      const local = workspace.entries();
      const first = local[0];
      assert(first);
      const merged = [
        ...local,
        {
          ...structuredClone(first),
          id: 7,
          comment: 'Rin',
        },
      ];
      return { afterClosed: () => of({ entries: merged, imported: 1, overwritten: 0, skipped: 0 }) };
    });

    await actions.importMergeFromPicker();

    const entries = workspace.entries();
    expect(entries.map((e) => e.id)).toContain(7);
    expect(entries.find((e) => e.id === localId)).toBeTruthy();
    expect(snackBarOpen).toHaveBeenCalledWith(
      'Merged: 1 new, 0 overwritten, 0 skipped.',
      'OK',
      expect.anything(),
    );
  });

  it('leaves the book untouched when the merge is cancelled', async () => {
    await workspace.createProject('Fuyuki');
    workspace.addEntry();
    stubFilePicker(jsonFile('book.json', { entries: {} }));

    await actions.importMergeFromPicker();

    expect(workspace.entries()).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Splitting (export selected entries)
  // ---------------------------------------------------------------------------

  it('refuses exporting a selection without an open project', async () => {
    await actions.exportSelectedEntries([0]);

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(snackBarOpen).toHaveBeenCalledWith(
      expect.stringContaining('Create or open a project before exporting.'),
      'OK',
      expect.anything(),
    );
  });

  it('exports the picked selection as a standalone book', async () => {
    await workspace.createProject('Fuyuki');
    const exportSpy = vi.spyOn(importer, 'exportSelectedBook').mockImplementation(() => undefined);
    dialogOpen.mockReturnValue({
      afterClosed: () => of({ entryIds: [0, 2], title: 'Split book', format: 'st_native' }),
    });

    await actions.exportSelectedEntries([0]);

    const project = workspace.activeProject();
    assert(project);
    expect(exportSpy).toHaveBeenCalledWith(
      project.activeBook,
      [0, 2],
      'Split book',
      'st_native',
    );
    expect(snackBarOpen).toHaveBeenCalledWith(
      expect.stringContaining('Exported 2 entries as “Split book”'),
      'OK',
      expect.anything(),
    );
  });

  it('exports nothing when the picker dialog is dismissed', async () => {
    await workspace.createProject('Fuyuki');
    const exportSpy = vi.spyOn(importer, 'exportSelectedBook').mockImplementation(() => undefined);

    await actions.exportSelectedEntries([0]);

    expect(exportSpy).not.toHaveBeenCalled();
  });

  it('exports nothing when the project disappeared while the dialog was open', async () => {
    await workspace.createProject('Fuyuki');
    const exportSpy = vi.spyOn(importer, 'exportSelectedBook').mockImplementation(() => undefined);
    dialogOpen.mockImplementation(() => {
      workspace.activeProject.set(null);
      return { afterClosed: () => of({ entryIds: [0], title: 'Split', format: 'st_native' }) };
    });

    await actions.exportSelectedEntries([0]);

    expect(exportSpy).not.toHaveBeenCalled();
  });
});
