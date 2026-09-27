import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CharacterBookEntry, createEmptyEntry } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { EDIT_COMMIT_DEBOUNCE_MS } from './entry-editor.constants';
import { entrySliceSignal } from './entry-edit-form';

/**
 * Comment-slice host: the smallest concrete shape of an `entrySliceSignal`
 * consumer (`EntryName` is exactly this slice). The specs test through the
 * real exported factory, never a copy.
 */
@Component({
  selector: 'app-slice-host',
  template: '',
})
class SliceHost {
  /** The workspace-owned entry under edit; may drop back to undefined. */
  readonly entry = input<CharacterBookEntry>();

  readonly model = entrySliceSignal<{ comment: string }>({
    source: this.entry,
    fallback: { comment: '' },
    pick: (entry) => ({ comment: entry.comment ?? '' }),
    toPatch: (_entry, model) => ({ comment: model.comment }),
  });
}

/** A slice whose `toPatch` normalizes, so its write does not round-trip. */
@Component({
  selector: 'app-normalizing-slice-host',
  template: '',
})
class NormalizingSliceHost {
  readonly entry = input<CharacterBookEntry>();

  readonly model = entrySliceSignal<{ comment: string }>({
    source: this.entry,
    fallback: { comment: '' },
    pick: (entry) => ({ comment: entry.comment ?? '' }),
    toPatch: (_entry, model) => ({ comment: model.comment.trim() }),
  });
}

describe('entrySliceSignal idle-commit', () => {
  const updateEntry = vi.fn();
  let fixture: ComponentFixture<SliceHost>;
  let host: SliceHost;

  /** The seeded entry every test starts from (id 1, comment "Original"). */
  const original = (): CharacterBookEntry => ({ ...createEmptyEntry(1), comment: 'Original' });

  /** Binds the entry and flushes the reseed + write effects synchronously. */
  function seed(entry: CharacterBookEntry | undefined): void {
    fixture.componentRef.setInput('entry', entry);
    fixture.detectChanges();
  }

  /** A real (non-no-op) slice edit, flushed so the write effect arms the timer. */
  function edit(comment: string): void {
    host.model.set({ comment });
    fixture.detectChanges();
  }

  beforeEach(() => {
    updateEntry.mockClear();
    // The idle-commit debounce settles on fake time (house pattern —
    // entry-list.spec.ts): only the timer pair is faked, so
    // fixture.whenStable() is never starved.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    TestBed.configureTestingModule({
      imports: [SliceHost],
      providers: [{ provide: WorkspaceService, useValue: { updateEntry } }],
    });
    fixture = TestBed.createComponent(SliceHost);
    host = fixture.componentInstance;
    seed(original());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits once after idle, not per keystroke, carrying the last slice', async () => {
    edit('a');
    edit('ab');
    edit('abc');
    expect(updateEntry).not.toHaveBeenCalled();

    // One keystroke short of the window: still nothing written.
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS - 1);
    expect(updateEntry).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(updateEntry).toHaveBeenCalledOnce();
    expect(updateEntry).toHaveBeenCalledWith(1, { comment: 'abc' });
  });

  it('flushes the pending draft on DestroyRef teardown', () => {
    edit('draft');
    expect(updateEntry).not.toHaveBeenCalled();

    // Tab close / pane switch: the draft lands synchronously, timer dropped.
    fixture.destroy();
    expect(updateEntry).toHaveBeenCalledOnce();
    expect(updateEntry).toHaveBeenCalledWith(1, { comment: 'draft' });
  });

  it('never arms the timer for an edit that round-trips through pick', async () => {
    edit('Original');
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS * 2);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('drops a stale draft the user undid back to the entry value inside the window', async () => {
    // Typing arms the timer; undoing back to the entry's own value within
    // the window hits the no-op guard, which re-arms nothing — the earlier
    // timer is only neutralized by the fire-time re-check against the
    // current entry (commitDraft).
    edit('draft');
    host.model.set({ comment: 'Original' });
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS * 2);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('re-applies the pending draft when an external patch misses the slice', async () => {
    edit('draft');

    // External replacement while the draft pends: only `enabled` changed.
    const incoming: CharacterBookEntry = { ...original(), enabled: false };
    seed(incoming);

    // The merge rule re-applied the draft onto the incoming entry, and the
    // re-apply is itself a flush: the model keeps the draft, the timer is
    // consumed with it.
    expect(updateEntry).toHaveBeenCalledOnce();
    expect(updateEntry).toHaveBeenCalledWith(1, { comment: 'draft' });
    expect(host.model()).toEqual({ comment: 'draft' });

    // Our own follow-up emission is swallowed: rebinding to the post-write
    // entry reseeds nothing and the echo flag does not stick.
    seed({ ...incoming, comment: 'draft' });
    expect(host.model()).toEqual({ comment: 'draft' });
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS * 2);
    expect(updateEntry).toHaveBeenCalledOnce();
  });

  it('reseeds from the incoming entry when an external patch overlaps the slice', async () => {
    edit('draft');

    // Delimiter re-wrap applied while typing: the slice field changed
    // externally, so external wins — no draft write, model re-seeded.
    seed({ ...original(), comment: 'External' });
    expect(updateEntry).not.toHaveBeenCalled();
    expect(host.model()).toEqual({ comment: 'External' });

    // The timer was dropped with the draft: idling writes nothing.
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS * 2);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('does not echo its own committed write back into the workspace', async () => {
    edit('draft');
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS);
    expect(updateEntry).toHaveBeenCalledOnce();

    // The post-write entry reaches the mirror through the input rebind:
    // pick-equality drops the reseed, so nothing re-arms.
    seed({ ...original(), comment: 'draft' });
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS * 2);
    expect(updateEntry).toHaveBeenCalledOnce();
  });

  it('drops the draft when the entry id changes while it pends', async () => {
    edit('draft');
    seed({ ...createEmptyEntry(2), comment: 'Other' });

    // Reseeded from the new entry; nothing was written to either id.
    expect(host.model()).toEqual({ comment: 'Other' });
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS * 2);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('drops the draft when the entry vanishes before the timer fires', async () => {
    edit('draft');
    seed(undefined);

    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS * 2);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('settles a non-round-trip commit through the write-effect no-op guard', async () => {
    const normFixture = TestBed.createComponent(NormalizingSliceHost);
    const normHost = normFixture.componentInstance;
    const entry = original();
    normFixture.componentRef.setInput('entry', entry);
    normFixture.detectChanges();

    // `toPatch` trims, so the committed entry echoes back a DIFFERENT slice.
    normHost.model.set({ comment: '  padded  ' });
    normFixture.detectChanges();
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS);

    expect(updateEntry).toHaveBeenCalledOnce();
    expect(updateEntry).toHaveBeenCalledWith(1, { comment: 'padded' });

    // The echo lands as a real reseed (model adopts the normalized value),
    // but the write effect's no-op guard holds — still exactly one write.
    normFixture.componentRef.setInput('entry', { ...entry, comment: 'padded' });
    normFixture.detectChanges();
    expect(normHost.model()).toEqual({ comment: 'padded' });
    await vi.advanceTimersByTimeAsync(EDIT_COMMIT_DEBOUNCE_MS * 2);
    expect(updateEntry).toHaveBeenCalledOnce();
  });
});
