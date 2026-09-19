import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { CharacterBookEntry, createEmptyEntry } from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { EntryContentField } from './entry-content-field';
import { projectOf } from '../../../../testing/project-fixtures';

describe('EntryContentField', () => {
  let workspace: WorkspaceService;
  let fixture: ComponentFixture<EntryContentField>;

  function currentEntry(): CharacterBookEntry {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  async function createPane(
    overrides: Partial<CharacterBookEntry> = {},
  ): Promise<EntryContentField> {
    workspace.activeProject.set(
      projectOf([{ ...createEmptyEntry(0), ...overrides }], { id: 'content-project', title: 'Content' }),
    );
    fixture = TestBed.createComponent(EntryContentField);
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** Rebinds the input to the entry's current workspace copy, like the
   * enclosing editor does after every CD cycle. */
  function rebind(): void {
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
  }

  /** Whitespace-normalized pane text, so multi-line template output matches. */
  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function textarea(): HTMLTextAreaElement {
    const area = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Entry content"]',
    );
    assert(area);
    return area;
  }

  /** Types into the content textarea like a user would. */
  async function type(text: string): Promise<void> {
    const area = textarea();
    area.value = text;
    area.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [EntryContentField, MatDialogModule] });
    workspace = TestBed.inject(WorkspaceService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('writes content edits through to the workspace entry', async () => {
    await createPane({ content: '' });

    await type('Rin studies magecraft');

    expect(currentEntry().content).toBe('Rin studies magecraft');
    expect(textarea().value).toBe('Rin studies magecraft');
  });

  it('recomputes the character / token / line stats on every edit', async () => {
    await createPane({ content: 'King of Knights' });

    // 15 latin chars round to 4 tokens at the ~4 chars/token heuristic.
    expect(text()).toContain('15 chars · ~4 tokens · 1 lines');

    // CJK tokenizes at one token per character, not per 4.
    await type('刀剑神域');
    expect(text()).toContain('4 chars · ~4 tokens · 1 lines');

    // Empty content shows zeroed stats instead of a stale count.
    await type('');
    expect(text()).toContain('0 chars · ~0 tokens · 0 lines');
  });

  it('shows the delimiter badge only for recognized wrapping', async () => {
    await createPane({ content: 'plain lore text' });
    expect(text()).not.toContain('click the code button to change');

    // After a round-trip through the workspace the badge appears (bracket style).
    await type('[Saber=\nKing of Knights]');
    rebind();
    expect(currentEntry().content).toBe('[Saber=\nKing of Knights]');
    expect(text()).toContain('[Saber=…]');
    expect(text()).toContain('click the code button to change');
  });

  it('opens the delimiter dialog for the entry under edit', async () => {
    const dialog = TestBed.inject(MatDialog);
    const openSpy = vi
      .spyOn(dialog, 'open')
      .mockReturnValue({} as unknown as MatDialogRef<unknown>);
    await createPane({ content: 'plain lore text' });

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.delimiter-btn',
    );
    assert(button);
    button.click();
    // The dialog loads through a dynamic import that can be slow on a loaded
    // CI machine; the wait must outlive it or the open lands after teardown.
    await vi.waitFor(() => expect(openSpy).toHaveBeenCalledOnce(), {
      timeout: 15_000,
      interval: 100,
    });

    expect(openSpy).toHaveBeenCalledOnce();
    expect(openSpy.mock.calls[0]?.[1]?.data).toEqual({ activeEntryId: 0 });
  });

  it('flags mismatched whole-content wrappers in the hint and tooltip', async () => {
    // Mismatched pairs need no hints: the broken pair shows on any entry.
    await createPane({ content: '<test>\nlore\n</universe>' });

    const el = fixture.nativeElement as HTMLElement;
    const hint = el.querySelector('.malformed-hint');
    assert(hint);
    expect(hint.classList.contains('malformed-hint')).toBe(true);
    expect(hint.textContent).toContain('<test> ? </universe>');
    expect(hint.textContent).toContain('click the code button to fix');

    const button = fixture.debugElement.query(By.css('.delimiter-btn'));
    assert(button);
    expect(button.injector.get(MatTooltip).message).toBe(
      'Content has mismatched or unclosed delimiters — click to fix',
    );
  });

  it('flags an orphaned opener only when the entry names match it', async () => {
    // The first primary key 'universe' matches the orphaned tag.
    await createPane({ comment: 'Arc', keys: ['universe'], content: '<universe>\nlore' });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.malformed-hint')?.textContent,
    ).toContain('<universe> ?');

    // A lone tag that matches neither comment nor key stays unclassified prose.
    await createPane({ comment: 'Arc', keys: ['universe'], content: '<div>\nlore' });
    expect((fixture.nativeElement as HTMLElement).querySelector('.malformed-hint')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'click the code button to fix',
    );
  });

  it('keeps the malformed hint out of clean prose', async () => {
    await createPane({ content: 'plain lore text' });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.malformed-hint')).toBeNull();
    expect(el.textContent).not.toContain('click the code button to fix');
  });
});
