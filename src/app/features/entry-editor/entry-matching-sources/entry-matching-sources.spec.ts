import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatChipOption } from '@angular/material/chips';
import { CharacterBookEntry, createEmptyEntry } from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { EntryMatchingSources } from './entry-matching-sources';
import { projectOf } from '../../../../testing/project-fixtures';

describe('EntryMatchingSources', () => {
  let workspace: WorkspaceService;
  let fixture: ComponentFixture<EntryMatchingSources>;

  function currentEntry(): CharacterBookEntry {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  async function createPane(
    overrides: Partial<CharacterBookEntry> = {},
  ): Promise<EntryMatchingSources> {
    workspace.activeProject.set(
      projectOf([{ ...createEmptyEntry(0), ...overrides }], { id: 'matching-project', title: 'Matching' }),
    );
    fixture = TestBed.createComponent(EntryMatchingSources);
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** Rebinds the input to the entry's current workspace copy, like the
   * enclosing accordion does after every CD cycle. */
  function rebind(): void {
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
  }

  function chip(index: number): MatChipOption {
    const instance = fixture.debugElement
      .queryAll(By.css('mat-chip-option'))
      [index]?.componentInstance as MatChipOption | undefined;
    assert(instance);
    return instance;
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [EntryMatchingSources] });
    workspace = TestBed.inject(WorkspaceService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('marks the stored matching sources and toggles one into the extensions', async () => {
    await createPane({
      extensions: {
        ...createEmptyEntry(0).extensions,
        match_scenario: true,
      },
    });

    // The stored flag feeds back into the chip selection (Scenario = index 2).
    const selected = fixture.debugElement
      .queryAll(By.css('mat-chip-option'))
      .map((c) => (c.componentInstance as MatChipOption).selected);
    expect(selected).toEqual([false, false, true, false, false, false]);

    // A user click writes the flag into the extensions.
    chip(0).toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['match_character_description']).toBe(true);
    expect(currentEntry().extensions['match_scenario']).toBe(true);
  });

  it('clears a stored matching source on deselect', async () => {
    await createPane({
      extensions: {
        ...createEmptyEntry(0).extensions,
        match_persona_description: true,
      },
    });

    chip(3).toggleSelected(true);
    rebind();

    expect(currentEntry().extensions['match_persona_description']).toBe(false);
  });
});
