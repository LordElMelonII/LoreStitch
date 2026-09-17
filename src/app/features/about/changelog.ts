/**
 * Minimal parser for the bundled CHANGELOG.md, tailored to the conventions
 * LoreStitch's changelog actually uses:
 *
 *     ## 1.0.0 — September 17, 2026
 *     Free-form intro paragraph.
 *     ### Highlights
 *     - First item
 *
 * Everything before the first `##` heading (the document title, preamble) is
 * ignored. Releases render newest-first, in document order.
 */

/** A named bullet group within a release ("Highlights", "Fixed", …). */
export interface ChangelogSection {
  readonly title: string;
  readonly items: readonly string[];
}

/** One `##` release heading with everything under it. */
export interface ChangelogRelease {
  readonly version: string;
  /** Free-form date text as written in the heading; null when omitted. */
  readonly date: string | null;
  /** Paragraphs (and stray bullets) before the first `###` section. */
  readonly intro: readonly string[];
  readonly sections: readonly ChangelogSection[];
}

/** Sections whose title matches this render in the "breaking" emphasis. */
export function isBreakingSection(title: string): boolean {
  return /breaking/i.test(title);
}

/** Renders inline Markdown (links, bold, code) as plain display text. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** First capture group of `pattern` against `line`, or null. */
function capture(pattern: RegExp, line: string): string | null {
  return pattern.exec(line)?.[1] ?? null;
}

/** Splits a `##` heading into its version token and free-form date. */
function splitVersionHeading(raw: string): { version: string; date: string | null } {
  const text = stripInlineMarkdown(raw);
  const match = text.match(/^(\S+)\s+[—–-]\s+(.+)$/);
  return match?.[1] && match[2]
    ? { version: match[1], date: match[2].trim() }
    : { version: text, date: null };
}

/** Mutable build-time shapes; the readonly interfaces are the public view. */
interface MutableSection {
  title: string;
  items: string[];
}

interface MutableRelease {
  version: string;
  date: string | null;
  intro: string[];
  sections: MutableSection[];
}

/** Where wrapped bullet lines keep flowing into (the last pushed item). */
interface ItemTarget {
  items: string[];
  index: number;
}

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: MutableRelease[] = [];
  let release: MutableRelease | null = null;
  let section: MutableSection | null = null;
  let lastItem: ItemTarget | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const version = capture(/^##\s+(.+)$/, line);
    if (version !== null) {
      const heading = splitVersionHeading(version);
      release = { ...heading, intro: [], sections: [] };
      section = null;
      lastItem = null;
      releases.push(release);
      continue;
    }
    if (!release) {
      continue; // Document title and preamble before the first release.
    }
    const sectionTitle = capture(/^###\s+(.+)$/, line);
    if (sectionTitle !== null) {
      section = { title: stripInlineMarkdown(sectionTitle), items: [] };
      lastItem = null;
      release.sections.push(section);
      continue;
    }
    const item = capture(/^[-*]\s+(.+)$/, line);
    if (item !== null) {
      const text = stripInlineMarkdown(item);
      const items = section ? section.items : release.intro;
      items.push(text);
      lastItem = { items, index: items.length - 1 };
      continue;
    }
    // An indented line wraps the previous bullet (standard Markdown), so it
    // merges into that item instead of becoming a phantom one of its own.
    const wrapped = capture(/^\s+(.+)$/, line);
    if (wrapped !== null && lastItem !== null) {
      const text = stripInlineMarkdown(wrapped);
      const current = lastItem.items[lastItem.index];
      if (current !== undefined) {
        lastItem.items[lastItem.index] = `${current} ${text}`;
        continue;
      }
    }
    lastItem = null;
    const paragraph = stripInlineMarkdown(line.trim());
    if (paragraph) {
      // Prose under a section renders alongside its bullets — never dropped.
      if (section) {
        section.items.push(paragraph);
        lastItem = { items: section.items, index: section.items.length - 1 };
      } else {
        release.intro.push(paragraph);
      }
    }
  }
  return releases;
}
