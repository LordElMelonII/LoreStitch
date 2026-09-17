import { isBreakingSection, parseChangelog } from './changelog';

describe('changelog parser', () => {
  it('parses releases, dates, sections and items from the documented format', () => {
    const releases = parseChangelog(`# LoreStitch Changelog

Preamble that must be ignored.

## 2.0.0 — March 1, 2027

The formatting release.

### Breaking changes

- Old projects need re-importing.
- Default theme switched.

### Fixed

- Crash on empty keys.

## 1.0.0 - September 17, 2026

### Highlights

- Version control for lorebooks.
`);

    expect(releases).toHaveLength(2);

    const latest = releases[0];
    assert(latest);
    expect(latest.version).toBe('2.0.0');
    expect(latest.date).toBe('March 1, 2027');
    expect(latest.intro).toEqual(['The formatting release.']);
    expect(latest.sections).toHaveLength(2);
    assert(latest.sections[0]);
    expect(latest.sections[0].title).toBe('Breaking changes');
    expect(latest.sections[0].items).toEqual([
      'Old projects need re-importing.',
      'Default theme switched.',
    ]);
    assert(latest.sections[1]);
    expect(latest.sections[1].items).toEqual(['Crash on empty keys.']);

    // Both em-dash and plain hyphen date separators are supported.
    const first = releases[1];
    assert(first);
    expect(first.version).toBe('1.0.0');
    expect(first.date).toBe('September 17, 2026');
    expect(first.sections[0]?.title).toBe('Highlights');
  });

  it('strips inline markdown (links, bold, code) from display text', () => {
    const releases = parseChangelog(`## 1.0.0 — 2026-09-17

### Notes

- Found a problem? Open an issue on the [GitHub repository](https://example.com).
- Uses **bold** and \`code\` spans.
`);

    const notes = releases[0]?.sections[0];
    assert(notes);
    expect(notes.items).toEqual([
      'Found a problem? Open an issue on the GitHub repository.',
      'Uses bold and code spans.',
    ]);
  });

  it('keeps releases in document order and tolerates releases without dates or sections', () => {
    const releases = parseChangelog(`## 0.9.0

Just an intro line.

## 0.8.0
`);

    expect(releases.map((r) => r.version)).toEqual(['0.9.0', '0.8.0']);
    expect(releases[0]?.sections).toEqual([]);
    expect(releases[1]?.date).toBeNull();
    expect(releases[1]?.sections).toEqual([]);
    expect(releases[1]?.intro).toEqual([]);
  });

  it('collects stray bullets before any section into the intro', () => {
    const releases = parseChangelog(`## 0.7.0 — 2025-12-01

- A stray highlight.
`);
    expect(releases[0]?.intro).toEqual(['A stray highlight.']);
    expect(releases[0]?.sections).toEqual([]);
  });

  it('merges indented continuation lines into the bullet they wrap', () => {
    const releases = parseChangelog(`## 1.0.0 — September 17, 2026

### Highlights

- **Deep entry editor** — keys, activation, placement,
  recursion and timing settings mirror the World Info panel,
  so nothing is lost on the way back into SillyTavern.
- **Token meter** — a live context-budget estimate.

### Notes

- Found a problem? Open an issue.
`);

    const highlights = releases[0]?.sections[0];
    assert(highlights);
    expect(highlights.items).toEqual([
      'Deep entry editor — keys, activation, placement, recursion and timing ' +
        'settings mirror the World Info panel, so nothing is lost on the way ' +
        'back into SillyTavern.',
      'Token meter — a live context-budget estimate.',
    ]);
    // A wrapped bullet does not leak into the next section either.
    expect(releases[0]?.sections[1]?.items).toEqual(['Found a problem? Open an issue.']);
  });

  it('keeps prose lines under a section instead of dropping them', () => {
    const releases = parseChangelog(`## 0.6.0 — 2025-10-01

### Fixes

- A real fix.
A trailing explanatory sentence.
`);
    expect(releases[0]?.sections[0]?.items).toEqual([
      'A real fix.',
      'A trailing explanatory sentence.',
    ]);
  });

  it('returns nothing for empty or release-less documents', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('# Changelog\n\nNothing to see here.\n')).toEqual([]);
  });

  it('flags breaking sections case-insensitively', () => {
    expect(isBreakingSection('Breaking changes')).toBe(true);
    expect(isBreakingSection('BREAKING')).toBe(true);
    expect(isBreakingSection('Highlights')).toBe(false);
  });
});
