import { ComponentFixture, TestBed } from '@angular/core/testing';
import { createEmptyBook } from '../../core/models/lorebook.model';
import { ProjectWorkspace } from '../../core/models/project.model';
import { ImportExportService } from '../../core/services/import-export.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { CommitHistory } from './commit-history';

/** A bare workspace with no commit history at all (the @empty case). */
function emptyProject(): ProjectWorkspace {
  return {
    id: 'history-project',
    title: 'History',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: createEmptyBook('History'),
    headCommitId: null,
    commits: [],
  };
}

describe('CommitHistory', () => {
  let workspace: WorkspaceService;
  let importer: ImportExportService;
  let fixture: ComponentFixture<CommitHistory>;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function project(): ProjectWorkspace {
    const active = workspace.activeProject();
    assert(active);
    return active;
  }

  function text(selector: string): string {
    return element().querySelector(selector)?.textContent?.trim() ?? '';
  }

  function commitInput(): HTMLInputElement {
    const input = element().querySelector<HTMLInputElement>('input[aria-label="Commit message"]');
    assert(input);
    return input;
  }

  function commitButton(): HTMLButtonElement {
    const button = element().querySelector<HTMLButtonElement>('.commit-actions button');
    assert(button);
    return button;
  }

  /** Simulates real typing: sets the value and fires the input event. */
  function type(text: string): void {
    const input = commitInput();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pressEnter(): void {
    commitInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  }

  async function mount(): Promise<CommitHistory> {
    fixture = TestBed.createComponent(CommitHistory);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** Waits for an async (hashing/persistence) workspace transition, then for CD. */
  async function settleUntil(check: () => void): Promise<void> {
    await vi.waitFor(check, { timeout: 5000 });
    await fixture.whenStable();
  }

  /** Seeds one entry and two commits on top of the initial commit. */
  async function seedTwoCommits(first: string, second: string): Promise<void> {
    workspace.addEntry();
    workspace.updateEntry(0, { content: first });
    await workspace.commit(`Add ${first}`);
    workspace.updateEntry(0, { content: second });
    await workspace.commit(`Make ${second}`);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [CommitHistory] });
    workspace = TestBed.inject(WorkspaceService);
    importer = TestBed.inject(ImportExportService);
    // Allow the workspace's async init() to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  describe('history list', () => {
    it('shows the empty timeline for a project without commits', async () => {
      workspace.activeProject.set(emptyProject());
      const component = await mount();

      expect(component['rows']()).toEqual([]);
      expect(text('.empty')).toContain('No commits yet');
      // Without a HEAD snapshot the workspace counts as dirty.
      expect(workspace.hasUnsavedChanges()).toBe(true);
      expect(text('.dirty-note')).toContain('Uncommitted changes present');
    });

    it('renders the initial commit with short hash, head marker and timestamp', async () => {
      await workspace.createProject('History');
      const component = await mount();

      const [row] = component['rows']();
      assert(row);
      expect(row.commit.message).toBe('Initial commit');
      // The root commit has no parent, so its diff baseline is empty.
      expect(row.parent).toBeNull();
      expect(component['hash'](row.commit.id)).toBe(row.commit.id.slice(0, 7));
      expect(component['hash'](row.commit.id)).toHaveLength(7);

      expect(text('.commit .hash')).toBe(row.commit.id.slice(0, 7));
      expect(text('.commit .msg')).toContain('Initial commit');
      expect(element().querySelector('.commit .msg')?.className).toContain('head');
      expect(text('.commit .meta')).toContain('0 entries');
      expect(text('.commit .meta')).toMatch(/\d+s ago/);
      // A fresh project is clean and offers nothing to commit.
      expect(workspace.hasUnsavedChanges()).toBe(false);
      expect(text('.clean-note')).toContain('Working tree clean');
      expect(element().querySelector('.dirty-note')).toBeNull();
      expect(commitButton().disabled).toBe(true);
    });

    it('lists the newest commit first and moves the head marker to it', async () => {
      await workspace.createProject('History');
      const component = await mount();
      await seedTwoCommits('alpha text', 'beta text');
      const commits = project().commits;
      expect(commits).toHaveLength(3);

      // Newest first: exactly the stored commit order, reversed.
      expect(component['rows']().map((row) => row.commit.id)).toEqual(
        commits.map((commit) => commit.id).reverse(),
      );
      expect(component['rows']()[0]?.commit.message).toBe('Make beta text');
      expect(component['rows']()[2]?.commit.message).toBe('Initial commit');

      // Parent links point back through the chain (newest -> middle commit).
      const head = component['rows']()[0];
      assert(head);
      expect(head.parent?.id).toBe(commits[1]?.id);
      expect(component['rows']()[2]?.parent).toBeNull();

      const messages = [...element().querySelectorAll('.commit .msg')].map(
        (msg) => msg.textContent?.trim() ?? '',
      );
      expect(messages[0]).toBe('Make beta text');
      expect(messages.at(-1)).toBe('Initial commit');
      expect(element().querySelector('.commit .msg')?.className).toContain('head');
    });
  });

  describe('dirty state and commit box', () => {
    it('flags uncommitted changes and enables commit only with a valid message', async () => {
      await workspace.createProject('History');
      const component = await mount();
      expect(commitButton().disabled).toBe(true);

      workspace.addEntry();
      await fixture.whenStable();
      expect(workspace.hasUnsavedChanges()).toBe(true);
      expect(text('.dirty-note')).toContain('Uncommitted changes present');
      expect(element().querySelector('.clean-note')).toBeNull();
      // Still disabled: the message is empty.
      expect(commitButton().disabled).toBe(true);

      type('Add entry zero');
      await fixture.whenStable();
      expect(component['canCommit']()).toBe(true);
      expect(commitButton().disabled).toBe(false);

      // A whitespace-only message is not a message.
      type('   ');
      await fixture.whenStable();
      expect(component['canCommit']()).toBe(false);
      expect(commitButton().disabled).toBe(true);
    });

    it('creates a commit from the typed message and returns the tree to clean', async () => {
      await workspace.createProject('History');
      const component = await mount();
      const headBefore = project().headCommitId;

      workspace.addEntry();
      await fixture.whenStable();
      type('Add entry zero');
      await fixture.whenStable();
      commitButton().click();

      await settleUntil(() => expect(project().commits).toHaveLength(2));
      await vi.waitFor(() => expect(component['messageModel']().message).toBe(''), {
        timeout: 5000,
      });

      const head = project().commits.at(-1);
      assert(head);
      expect(project().headCommitId).toBe(head.id);
      expect(head.id).not.toBe(headBefore);
      expect(head.message).toBe('Add entry zero');
      expect(head.parentId).toBe(headBefore);
      expect(head.snapshot.entries).toHaveLength(1);
      expect(workspace.hasUnsavedChanges()).toBe(false);
      expect(text('.clean-note')).toContain('Working tree clean');

      // The message box is cleared and the new commit sits on top.
      expect(commitInput().value).toBe('');
      expect(component['rows']()[0]?.commit.id).toBe(head.id);
      expect(text('.commit .msg')).toContain('Add entry zero');
      expect(text('.commit .meta')).toContain('1 entries');
    });

    it('commits on Enter from the message field', async () => {
      await workspace.createProject('History');
      await mount();
      workspace.addEntry();
      await fixture.whenStable();

      type('Enter-made commit');
      pressEnter();

      await settleUntil(() => expect(project().commits).toHaveLength(2));
      expect(project().commits.at(-1)?.message).toBe('Enter-made commit');
    });

    it('rejects an empty message with the required error and no commit', async () => {
      await workspace.createProject('History');
      const component = await mount();
      workspace.addEntry();
      await fixture.whenStable();

      pressEnter();
      await fixture.whenStable();

      expect(project().commits).toHaveLength(1);
      expect(project().headCommitId).toBe(project().commits[0]?.id);
      expect(element().querySelector('mat-error')?.textContent).toContain(
        'A commit message is required',
      );
      expect(component['commitForm'].message().touched()).toBe(true);
    });

    it('rejects messages longer than 200 characters', async () => {
      await workspace.createProject('History');
      const component = await mount();
      workspace.addEntry();

      component['messageModel'].set({ message: 'x'.repeat(201) });
      await fixture.whenStable();

      expect(component['commitForm']().valid()).toBe(false);
      expect(component['canCommit']()).toBe(false);
      expect(commitButton().disabled).toBe(true);
      expect(component['commitForm'].message().errors()[0]?.message).toContain('200');

      await component['commit']();
      await fixture.whenStable();
      expect(project().commits).toHaveLength(1); // submit refused the action
    });

    it('refuses to commit while the working tree is clean', async () => {
      await workspace.createProject('History');
      const component = await mount();

      type('Nothing changed');
      await fixture.whenStable();

      // The message itself is valid; only the clean tree blocks the commit.
      expect(component['commitForm']().valid()).toBe(true);
      expect(component['canCommit']()).toBe(false);
      expect(commitButton().disabled).toBe(true);
      expect(project().commits).toHaveLength(1);
    });

    it('ignores re-entrant commits while one is in flight', async () => {
      await workspace.createProject('History');
      const component = await mount();
      workspace.addEntry();
      component['messageModel'].set({ message: 'Gated commit' });

      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const commitSpy = vi.spyOn(workspace, 'commit').mockReturnValue(gate.then(() => true));

      const pending = component['commit']();
      expect(component['committing']()).toBe(true);
      await fixture.whenStable();
      expect(commitButton().disabled).toBe(true);
      expect(text('.commit-actions button')).toContain('Committing');

      component['commit'](); // must be a no-op while the first is pending
      expect(commitSpy).toHaveBeenCalledTimes(1);

      release();
      await pending;
      await fixture.whenStable();

      expect(commitSpy).toHaveBeenCalledTimes(1);
      expect(component['committing']()).toBe(false);
      expect(component['messageModel']().message).toBe('');
      expect(text('.commit-actions button')).not.toContain('Committing');
    });
  });

  describe('rollback', () => {
    it('restores an older commit and appends a revert commit without rewriting history', async () => {
      await workspace.createProject('History');
      const component = await mount();
      await seedTwoCommits('alpha text', 'beta text');
      const alpha = project().commits.find((commit) => commit.message === 'Add alpha text');
      assert(alpha);

      const restore = element().querySelector<HTMLButtonElement>(
        '[aria-label="Restore Add alpha text"]',
      );
      assert(restore);
      restore.click();

      await settleUntil(() => expect(project().commits).toHaveLength(4));
      await fixture.whenStable();

      const revert = project().commits.at(-1);
      assert(revert);
      expect(project().headCommitId).toBe(revert.id);
      expect(revert.message).toBe(`Revert to ${alpha.id.slice(0, 7)}: Add alpha text`);
      // The old book content is back and HEAD matches it.
      const restored = project().activeBook.entries[0];
      assert(restored);
      expect(restored.content).toBe('alpha text');
      expect(workspace.hasUnsavedChanges()).toBe(false);

      // History was appended, not rewritten.
      expect(project().commits.map((commit) => commit.message)).toEqual([
        'Initial commit',
        'Add alpha text',
        'Make beta text',
        revert.message,
      ]);
      // The revert commit renders on top with the head marker.
      expect(text('.commit .msg')).toContain(`Revert to ${alpha.id.slice(0, 7)}`);
      expect(element().querySelector('.commit .msg')?.className).toContain('head');
      expect(component['rows']()[0]?.commit.id).toBe(revert.id);
    });
  });

  describe('per-commit diffs', () => {
    it('toggles the diff of a commit against its parent snapshot', async () => {
      await workspace.createProject('History');
      const component = await mount();
      const initialId = project().headCommitId;
      assert(initialId);

      workspace.addEntry();
      workspace.updateEntry(0, { content: 'Dragon guards the bridge' });
      await workspace.commit('Add dragon');
      await fixture.whenStable();
      const dragon = project().commits.at(-1);
      assert(dragon);

      expect(element().querySelector('.commit-diff')).toBeNull();

      element()
        .querySelector<HTMLButtonElement>('[aria-label="Toggle diff for Add dragon"]')
        ?.click();
      await fixture.whenStable();

      expect(component['expanded']()).toBe(dragon.id);
      const diffPanel = element().querySelector('.commit-diff');
      expect(diffPanel?.querySelector('app-diff-viewer')).toBeTruthy();
      // The entry added since the parent snapshot shows as an added line.
      const addedLines = [...(diffPanel?.querySelectorAll('.diff-line.added .text') ?? [])].map(
        (line) => line.textContent ?? '',
      );
      expect(addedLines.join('\n')).toContain('Dragon guards the bridge');

      const diffTexts = component['expandedDiff']();
      assert(diffTexts);
      expect(diffTexts.oldText).not.toContain('Dragon guards the bridge');
      expect(diffTexts.newText).toContain('Dragon guards the bridge');

      // The root commit diffs against an empty baseline.
      element()
        .querySelector<HTMLButtonElement>('[aria-label="Toggle diff for Initial commit"]')
        ?.click();
      await fixture.whenStable();
      const rootDiff = component['expandedDiff']();
      assert(rootDiff);
      expect(rootDiff.oldText).toBe('');
      expect(element().querySelectorAll('.commit-diff')).toHaveLength(1);

      // Clicking the same row again collapses the diff.
      element()
        .querySelector<HTMLButtonElement>('[aria-label="Toggle diff for Initial commit"]')
        ?.click();
      await fixture.whenStable();
      expect(component['expanded']()).toBeNull();
      expect(element().querySelector('.commit-diff')).toBeNull();
    });
  });

  describe('archive export', () => {
    it('exports the open workspace as a .stproj archive', async () => {
      await workspace.createProject('History');
      await mount();
      const exportSpy = vi
        .spyOn(importer, 'exportProject')
        .mockImplementation(() => ({ ok: true }));

      element().querySelector<HTMLButtonElement>('.history-hint button')?.click();
      await fixture.whenStable();

      expect(exportSpy).toHaveBeenCalledTimes(1);
      expect(exportSpy).toHaveBeenCalledWith(project());
    });

    it('skips the archive export without an open project', async () => {
      await mount();
      const exportSpy = vi
        .spyOn(importer, 'exportProject')
        .mockImplementation(() => ({ ok: true }));

      element().querySelector<HTMLButtonElement>('.history-hint button')?.click();
      await fixture.whenStable();

      expect(exportSpy).not.toHaveBeenCalled();
    });
  });

  describe('relative timestamps', () => {
    it('formats compact relative labels for every range', async () => {
      const component = await mount();
      const now = Date.now();
      const ago = component['ago'].bind(component);

      expect(ago(now - 500)).toBe('1s ago');
      expect(ago(now - 45_000)).toMatch(/^\d+s ago$/);
      expect(ago(now - 5 * 60_000)).toBe('5m ago');
      expect(ago(now - 2 * 3_600_000)).toBe('2h ago');
      expect(ago(now - 3 * 86_400_000)).toBe('3d ago');
      // Beyond a month it falls back to an absolute date.
      expect(ago(now - 40 * 86_400_000)).not.toContain('ago');
    });
  });
});
