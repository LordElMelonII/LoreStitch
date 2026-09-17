import { TestBed } from '@angular/core/testing';
import { MatChipSelectionChange } from '@angular/material/chips';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import {
  CharacterBookEntry,
  createEmptyEntry,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { EntryUpdatesService } from './entry-updates.service';

describe('EntryUpdatesService', () => {
  let workspace: WorkspaceService;
  let updates: EntryUpdatesService;

  function currentEntry(): CharacterBookEntry {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  function setEntry(overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
    workspace.activeProject.set({
      id: 'updates-project',
      title: 'Updates',
      createdAt: 1,
      updatedAt: 1,
      targetType: 'standalone_lorebook',
      activeBook: {
        name: 'Updates',
        extensions: {},
        entries: [{ ...createEmptyEntry(0), ...overrides }],
      },
      headCommitId: null,
      commits: [],
    });
    return currentEntry();
  }

  /** Slide-toggle change as the real control emits it. */
  function slide(checked: boolean): MatSlideToggleChange {
    return { source: null, checked } as unknown as MatSlideToggleChange;
  }

  /** Chip selection change; `isUserInput` is false for programmatic updates. */
  function chip(selected: boolean, isUserInput = true): MatChipSelectionChange {
    return { source: null, selected, isUserInput } as unknown as MatChipSelectionChange;
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    workspace = TestBed.inject(WorkspaceService);
    updates = TestBed.inject(EntryUpdatesService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  describe('flag patches', () => {
    it('writes enabled, selective and case_sensitive through the workspace', () => {
      const entry = setEntry();

      updates.setFlag(entry, 'enabled', slide(false));
      expect(currentEntry().enabled).toBe(false);

      updates.setFlag(currentEntry(), 'selective', slide(true));
      updates.setFlag(currentEntry(), 'case_sensitive', slide(true));
      expect(currentEntry().selective).toBe(true);
      expect(currentEntry().case_sensitive).toBe(true);
    });

    it('ignores a programmatic chip change that is not user input', () => {
      const entry = setEntry();

      updates.setChipFlag(entry, 'case_sensitive', chip(true, false));
      expect(currentEntry().case_sensitive).toBeUndefined();

      // The same change with isUserInput=true (a real click) patches.
      updates.setChipFlag(currentEntry(), 'case_sensitive', chip(true));
      expect(currentEntry().case_sensitive).toBe(true);
    });

    it('gates boolean extension chips behind user input too', () => {
      const entry = setEntry();

      updates.setExtensionChipFlag(entry, 'ignore_budget', chip(true, false));
      expect(currentEntry().extensions['ignore_budget']).toBe(false);

      updates.setExtensionChipFlag(currentEntry(), 'ignore_budget', chip(true));
      expect(currentEntry().extensions['ignore_budget']).toBe(true);
    });

    it('never patches transient entries without an id', () => {
      const entry = setEntry();
      const transient = { ...structuredClone(entry), id: undefined };

      updates.setFlag(transient, 'enabled', slide(false));
      updates.setChipFlag(transient, 'selective', chip(true));
      updates.setTriggerState(transient, 'constant');

      const stored = currentEntry();
      expect(stored.enabled).toBe(true);
      expect(stored.selective).toBe(false);
      expect(stored.constant).toBe(false);
    });
  });

  describe('trigger filter', () => {
    it('adds to the filter keeping the canonical ST order', () => {
      const entry = setEntry({
        extensions: { ...createEmptyEntry(0).extensions, triggers: ['regenerate', 'quiet'] },
      });

      updates.toggleTrigger(entry, 'normal', chip(true));

      // 'normal' lands first although it was added last: the stored array
      // always follows the ST_TRIGGERS order exports round-trip through.
      expect(currentEntry().extensions['triggers']).toEqual([
        'normal',
        'regenerate',
        'quiet',
      ]);
    });

    it('removes a generation type while keeping the others', () => {
      const entry = setEntry({
        extensions: { ...createEmptyEntry(0).extensions, triggers: ['normal', 'swipe'] },
      });

      updates.toggleTrigger(entry, 'normal', chip(false));

      expect(currentEntry().extensions['triggers']).toEqual(['swipe']);
    });

    it('drops unknown stored values when rewriting the filter', () => {
      const entry = setEntry({
        extensions: { ...createEmptyEntry(0).extensions, triggers: ['weird', 'swipe'] },
      });

      updates.toggleTrigger(entry, 'quiet', chip(true));

      // 'weird' is not an ST generation type and is dropped on rewrite.
      expect(currentEntry().extensions['triggers']).toEqual(['swipe', 'quiet']);
    });

    it('ignores a programmatic trigger chip change', () => {
      const entry = setEntry();

      updates.toggleTrigger(entry, 'normal', chip(true, false));

      expect(currentEntry().extensions['triggers']).toEqual([]);
    });
  });

  describe('delay until recursion', () => {
    it('turns on at level 1 when no deeper level is stored', () => {
      const entry = setEntry();

      updates.setDelayUntilRecursion(entry, chip(true));

      expect(currentEntry().extensions['delay_until_recursion']).toBe(true);
    });

    it('keeps a deeper stored level when re-selected', () => {
      const entry = setEntry({
        extensions: { ...createEmptyEntry(0).extensions, delay_until_recursion: 2 },
      });

      updates.setDelayUntilRecursion(entry, chip(true));

      expect(currentEntry().extensions['delay_until_recursion']).toBe(2);
    });

    it('clears the flag completely on deselect', () => {
      const entry = setEntry({
        extensions: { ...createEmptyEntry(0).extensions, delay_until_recursion: 2 },
      });

      updates.setDelayUntilRecursion(entry, chip(false));

      expect(currentEntry().extensions['delay_until_recursion']).toBe(false);
    });

    it('ignores a programmatic change', () => {
      const entry = setEntry();

      updates.setDelayUntilRecursion(entry, chip(true, false));

      expect(currentEntry().extensions['delay_until_recursion']).toBe(false);
    });
  });

  describe('character filter', () => {
    it('lazily defaults a missing filter for editing without patching', () => {
      const entry = setEntry();

      expect(updates.characterFilter(entry)).toEqual({
        is_exclude: false,
        names: [],
        tags: [],
      });
      // Reading must not write: the untouched filter stays null in storage.
      expect(currentEntry().extensions['character_filter']).toBeNull();
    });

    it('normalizes the legacy verbatim native filter shape', () => {
      const entry = setEntry({
        extensions: {
          ...createEmptyEntry(0).extensions,
          characterFilter: { isExclude: true, names: ['Saber'], tags: ['noble'] },
          character_filter: null,
        },
      });

      expect(updates.characterFilter(entry)).toEqual({
        is_exclude: true,
        names: ['Saber'],
        tags: ['noble'],
      });
    });

    it('inverts exclude mode while preserving names and tags', () => {
      const entry = setEntry({
        extensions: {
          ...createEmptyEntry(0).extensions,
          character_filter: { is_exclude: false, names: ['Saber'], tags: ['noble'] },
        },
      });

      updates.toggleCharacterFilterExclude(entry, chip(true));

      expect(currentEntry().extensions['character_filter']).toEqual({
        is_exclude: true,
        names: ['Saber'],
        tags: ['noble'],
      });
    });

    it('ignores a programmatic exclude change', () => {
      const entry = setEntry();

      updates.toggleCharacterFilterExclude(entry, chip(true, false));

      expect(currentEntry().extensions['character_filter']).toBeNull();
    });
  });

  describe('trigger strategy', () => {
    it('switches to constant and clears the vectorized mirror', () => {
      const entry = setEntry({
        constant: true,
        extensions: { ...createEmptyEntry(0).extensions, vectorized: true },
      });

      updates.setTriggerState(entry, 'constant');

      const stored = currentEntry();
      expect(stored.constant).toBe(true);
      expect(stored.extensions['vectorized']).toBe(false);
    });

    it('switches to vectorized, leaving constant off', () => {
      const entry = setEntry({ constant: true });

      updates.setTriggerState(entry, 'vectorized');

      const stored = currentEntry();
      expect(stored.constant).toBe(false);
      expect(stored.extensions['vectorized']).toBe(true);
    });

    it('switches back to normal, clearing both mirrors', () => {
      const entry = setEntry({
        constant: true,
        extensions: { ...createEmptyEntry(0).extensions, vectorized: true },
      });

      updates.setTriggerState(entry, 'normal');

      const stored = currentEntry();
      expect(stored.constant).toBe(false);
      expect(stored.extensions['vectorized']).toBe(false);
    });

    it('preserves unrelated extensions across a strategy switch', () => {
      const entry = setEntry({
        extensions: { ...createEmptyEntry(0).extensions, triggers: ['quiet'] },
      });

      updates.setTriggerState(entry, 'constant');

      const ext = currentEntry().extensions;
      expect(ext['probability']).toBe(100);
      expect(ext['triggers']).toEqual(['quiet']);
    });
  });
});
