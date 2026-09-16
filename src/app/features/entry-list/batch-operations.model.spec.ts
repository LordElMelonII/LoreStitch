import { CharacterBookEntry, createEmptyEntry } from '../../core/models/lorebook.model';
import { type BatchOperations, buildBatchPatch } from './batch-operations.model';

describe('buildBatchPatch', () => {
  function entry(overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
    return { ...createEmptyEntry(7), ...overrides };
  }

  it('returns null when no operation is set', () => {
    expect(buildBatchPatch(entry(), {})).toBeNull();
  });

  it('patches the enabled state', () => {
    const patch = buildBatchPatch(entry(), { enabled: false });
    expect(patch).toMatchObject({ enabled: false });
  });

  it('applies the constant strategy through the trigger state', () => {
    const patch = buildBatchPatch(entry(), { triggerState: 'constant' });
    expect(patch?.constant).toBe(true);
    expect(patch?.extensions?.['vectorized']).toBe(false);
  });

  it('applies the vectorized strategy without setting constant', () => {
    const patch = buildBatchPatch(entry({ constant: true }), { triggerState: 'vectorized' });
    expect(patch?.constant).toBe(false);
    expect(patch?.extensions?.['vectorized']).toBe(true);
  });

  it('sets insertion orders to a fixed value', () => {
    const patch = buildBatchPatch(entry({ insertion_order: 42 }), {
      insertionOrder: { mode: 'set', amount: 100 },
    });
    expect(patch?.insertion_order).toBe(100);
  });

  it('shifts insertion orders relative to each entry', () => {
    const patch = buildBatchPatch(entry({ insertion_order: 42 }), {
      insertionOrder: { mode: 'shift', amount: -10 },
    });
    expect(patch?.insertion_order).toBe(32);
  });

  it('sets and clears the scan depth override', () => {
    const set = buildBatchPatch(entry(), { scanDepth: { mode: 'set', value: 3 } });
    expect(set?.extensions?.['scan_depth']).toBe(3);

    const cleared = buildBatchPatch(entry({ extensions: { scan_depth: 2 } }), {
      scanDepth: { mode: 'clear', value: 0 },
    });
    expect(cleared?.extensions?.['scan_depth']).toBeNull();
  });

  it('clears case sensitivity back to the book default', () => {
    const patch = buildBatchPatch(entry({ case_sensitive: true }), { caseSensitive: null });
    expect(patch?.case_sensitive).toBeUndefined();
    expect(patch?.extensions?.['case_sensitive']).toBeNull();
  });

  it('sets the selective logic mirror', () => {
    const patch = buildBatchPatch(entry(), { selectiveLogic: 2 });
    expect(patch?.extensions?.['selectiveLogic']).toBe(2);
  });

  it('sets the position and keeps the ST-native mirror in sync', () => {
    const patch = buildBatchPatch(entry(), { position: { position: 'after_char' } });
    expect(patch?.position).toBe('after_char');
    expect(patch?.extensions?.['position']).toBe(1);
  });

  it('writes depth and role when batching entries to @Depth', () => {
    const patch = buildBatchPatch(entry(), {
      position: { position: 'at_depth', depth: 2, role: 1 },
    });
    expect(patch?.position).toBe('at_depth');
    expect(patch?.extensions?.['position']).toBe(4);
    expect(patch?.extensions?.['depth']).toBe(2);
    expect(patch?.extensions?.['role']).toBe(1);
  });

  it('defaults depth and role for @Depth when not provided', () => {
    const patch = buildBatchPatch(entry(), { position: { position: 'at_depth' } });
    expect(patch?.extensions?.['depth']).toBe(4);
    expect(patch?.extensions?.['role']).toBe(0);
  });

  it('writes the outlet name when batching entries to the Outlet position', () => {
    const patch = buildBatchPatch(entry(), {
      position: { position: 'outlet', outletName: ' world_state ' },
    });
    expect(patch?.position).toBe('outlet');
    expect(patch?.extensions?.['position']).toBe(7);
    expect(patch?.extensions?.['outlet_name']).toBe('world_state');
  });

  it('adds tags without dropping existing ones or other extensions', () => {
    const source = entry();
    source.extensions = { ...source.extensions, vendor_color: 'keep me' };
    const patch = buildBatchPatch(source, { addTags: ['Fate', ' Servant ', 'Fate'] });
    expect(patch?.extensions?.['lorestitch_tags']).toEqual(['Fate', 'Servant']);
    expect(patch?.extensions?.['vendor_color']).toBe('keep me');
  });

  it('removes marked tags from each entry', () => {
    const source = entry();
    source.extensions = { ...source.extensions, lorestitch_tags: ['Fate', 'Servant'] };
    const patch = buildBatchPatch(source, { removeTags: ['Fate'] });
    expect(patch?.extensions?.['lorestitch_tags']).toEqual(['Servant']);
  });

  it('reports a no-op when tags already match', () => {
    const source = entry();
    source.extensions = { ...source.extensions, lorestitch_tags: ['Fate'] };
    // addTags dedupes to the existing list: nothing to write, so the entry
    // must not be counted as affected (null, not an empty rewrite).
    expect(buildBatchPatch(source, { addTags: ['Fate'] })).toBeNull();
  });

  it('returns null for entries the operations do not actually touch', () => {
    const source = entry({ enabled: false });
    const ops: BatchOperations = { enabled: false };
    expect(buildBatchPatch(source, ops)).toBeNull();
  });
});
