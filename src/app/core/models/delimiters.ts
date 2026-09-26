/**
 * Content delimiter helpers.
 *
 * SillyTavern lorebook entries commonly wrap their content so the model can
 * tell where one entry's block begins and ends. LoreStitch recognizes the
 * four conventions below, can strip them again, and can re-wrap content with
 * a different style or name:
 *
 *   tag:       <London>\ncontent\n</London>
 *   bracket:   [London=\ncontent]
 *   markdown:  ## London\n\ncontent          (optional trailing ---)
 *   separator: content\n\n---
 *
 * Every operation is pure and total (no throws). `wrap` -> `unwrap` is
 * byte-lossless for non-blank payloads under `tag`/`bracket` (the wrapper's
 * own structural newlines are consumed while the payload — padding, CRLF,
 * quotes, `<>[]=`, regex metacharacters, Unicode/emoji/CJK — is captured
 * verbatim), under `markdown` when the strip is name-matched (the header
 * line and one structural blank line are consumed; the payload — including
 * any trailing `---` — is captured verbatim) and under `separator` for
 * payloads that do not themselves end in a blank line (a body that does is
 * unavoidably indistinguishable from the marker run; `rewrap` still fixes it
 * to an idempotent canonical form). The same trailing-marker ambiguity
 * applies to a legacy (name-less) markdown strip, which treats a payload
 * ending in a marker line as the style's toggle marker. Blank payloads are a
 * no-op for every style, so no phantom wrapper is ever written into an entry.
 */

export type DelimiterStyle = 'tag' | 'bracket' | 'markdown' | 'separator' | 'none';

/** ATX heading depth of a markdown wrapper (1–6 `#` characters). */
export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface DetectedDelimiter {
  style: DelimiterStyle;
  /** Tag, bracket or markdown header name (empty for separator/none). */
  name: string;
  /** ATX heading level (markdown only). */
  level?: MarkdownHeadingLevel;
}

/**
 * Wrapper regexes. Each consumes at most one structural newline directly
 * inside the wrapper on either side; everything else is captured verbatim.
 * The tag backreference makes mismatched (`<foo>…</bar>`) and unclosed tags
 * fall through to `'none'`. Names are capped at 80 characters.
 */
const TAG_RE = /^\s*<([^<>\n]{1,80})>\r?\n?([\s\S]*?)\r?\n?<\/\1>\s*$/;
const BRACKET_RE = /^\s*\[([^\]\n=]{1,80})=\r?\n?([\s\S]*?)\r?\n?\]\s*$/;
/** Trailing `---` preceded by one structural newline (optionally a blank line). */
const SEPARATOR_RE = /^([\s\S]+?)\r?\n(?:\r?\n)?[ \t]*-{3,}[ \t]*$/;
/** A separator marker with no payload — already wrapped, never re-wrapped. */
const BARE_SEPARATOR_RE = /^\s*-{3,}\s*$/;
/**
 * Well-formed markdown wrapper: `[ \t]*#{1,6}[ \t]+name` alone on the first
 * line, at most one structural blank line, then the payload. The structural
 * newlines are consumed; the payload is captured verbatim (including any
 * trailing separator run, which is the style's toggle marker, and any
 * additional blank lines, which stay payload bytes). Names are capped at 80
 * code points after trim; the cap is enforced in code because the header
 * text is free prose.
 */
const MARKDOWN_RE = /^[ \t]*(#{1,6})[ \t]+([^\r\n]*)\r?\n(?:\r?\n)?([\s\S]*)$/;

/** Removes a trailing separator run (the markdown style's toggle marker). */
function stripTrailingSeparatorRun(text: string): string {
  if (BARE_SEPARATOR_RE.test(text)) {
    return '';
  }
  const run = /\r?\n(?:\r?\n)?[ \t]*-{3,}[ \t]*$/.exec(text);
  return run ? text.slice(0, run.index) : text;
}

/** A recognized markdown shape: heading level, header text and payload. */
interface MarkdownShape {
  level: MarkdownHeadingLevel;
  name: string;
  payload: string;
}

/**
 * Structural matcher for the well-formed markdown shape (see `MARKDOWN_RE`).
 * Returns null for anything ambiguous — an empty header text, one over the
 * 80-code-point cap, a payload that is blank apart from a trailing separator
 * run (`## Name\n\n---` alone is a separator with the header as payload).
 * A false null is always safe; a false positive would swallow payload.
 */
function matchMarkdownShape(text: string): MarkdownShape | null {
  const match = MARKDOWN_RE.exec(text);
  if (!match) {
    return null;
  }
  const hashes = match[1] ?? '';
  const name = (match[2] ?? '').trim();
  const payload = match[3] ?? '';
  if (name === '' || [...name].length > 80) {
    return null;
  }
  if (stripTrailingSeparatorRun(payload).trim() === '') {
    return null;
  }
  // 1–6 by construction: the regex only matches `#{1,6}`.
  return { level: hashes.length as MarkdownHeadingLevel, name, payload };
}

/** Recognizes which delimiter (if any) wraps the given content. */
export function detectDelimiter(content: string): DetectedDelimiter {
  const text = content ?? '';
  const tag = TAG_RE.exec(text);
  if (tag) {
    return { style: 'tag', name: tag[1]?.trim() ?? '' };
  }
  const bracket = BRACKET_RE.exec(text);
  if (bracket) {
    return { style: 'bracket', name: bracket[1]?.trim() ?? '' };
  }
  // Before `separator`: a markdown wrapper carrying a toggle marker must
  // classify as markdown, never as a bare trailing separator.
  const markdown = matchMarkdownShape(text);
  if (markdown) {
    return { style: 'markdown', name: markdown.name, level: markdown.level };
  }
  if (SEPARATOR_RE.test(text)) {
    return { style: 'separator', name: '' };
  }
  return { style: 'none', name: '' };
}

/**
 * Collapses characters that would break the wrapping syntax to spaces,
 * collapses whitespace runs, and caps the result at 80 code points.
 *
 * Quotes, regex metacharacters (`* + ? | { }`), and Unicode/emoji pass
 * through unchanged. The cap counts code points (not UTF-16 units), so a
 * surrogate pair is never split in half. An empty (or fully sanitized-away)
 * name stays empty; callers substitute their own fallback where one is
 * required.
 */
export function sanitizeDelimiterName(name: string): string {
  const collapsed = (name ?? '')
    .replace(/[<>=[\]\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...collapsed].slice(0, 80).join('');
}

/**
 * Case-insensitive, sanitized name match used by name-matched stripping.
 * Both sides are normalized with `sanitizeDelimiterName` before comparing,
 * so `'a=b'` and `'a[b'` compare equal.
 */
export function delimiterNameMatches(name: string, expectedNames: readonly string[]): boolean {
  const normalized = sanitizeDelimiterName(name).toLowerCase();
  return expectedNames.some(
    (expected) => sanitizeDelimiterName(expected).toLowerCase() === normalized,
  );
}

/**
 * Markdown-specific wrap options (additive — every other style ignores them).
 */
export interface MarkdownWrapOptions {
  /** ATX heading level of the emitted header. Defaults to `2`. */
  level?: MarkdownHeadingLevel;
  /** Whether to append the style's trailing `---` toggle marker. */
  trailingSeparator?: boolean;
}

/**
 * Wraps already-delimiter-free content in the given style. The payload is
 * embedded verbatim (never trimmed); only blank payloads short-circuit.
 *
 * The wrapper name is sanitized (`sanitizeDelimiterName`), falling back to
 * `'entry'` when nothing usable remains. The `separator` style returns a bare
 * marker unchanged: `---` already is the separator form, so appending another
 * one would accumulate on every re-apply. The `markdown` style shares that
 * guard — heading a bare marker would emit content that classifies as a
 * separator with the header as payload and double the header on re-apply —
 * and appends its toggle marker unconditionally when asked (a payload that
 * itself ends in blank lines is unavoidably indistinguishable from the
 * marker run; re-apply canonicalizes).
 */
export function wrapContent(
  content: string,
  style: Exclude<DelimiterStyle, 'none'>,
  name = '',
  options?: MarkdownWrapOptions,
): string {
  const body = content ?? '';
  // Blank payloads are a no-op: emitting a wrapper around nothing would add
  // phantom tokens and make re-apply non-idempotent.
  if (body.trim() === '') {
    return body;
  }
  const safeName = sanitizeDelimiterName(name) || 'entry';
  switch (style) {
    case 'tag':
      return `<${safeName}>\n${body}\n</${safeName}>`;
    case 'bracket':
      return `[${safeName}=\n${body}]`;
    case 'markdown': {
      if (BARE_SEPARATOR_RE.test(body)) {
        return body;
      }
      const level = options?.level ?? 2;
      const header = `${'#'.repeat(level)} ${safeName}`;
      return `${header}\n\n${body}${options?.trailingSeparator ? '\n\n---' : ''}`;
    }
    case 'separator':
      return BARE_SEPARATOR_RE.test(body) ? body : `${body}\n\n---`;
  }
}

/** Options for name-matched delimiter stripping (see `unwrapContent`). */
export interface UnwrapOptions {
  /**
   * Accepted tag/bracket wrapper names (case-insensitive, sanitized before
   * comparison). When omitted, any detected wrapper is stripped (legacy).
   */
  expectedNames?: readonly string[];
  /**
   * Whether a detected trailing separator may be stripped. Defaults to
   * `expectedNames === undefined` (conservative when the caller names
   * wrappers).
   */
  stripSeparator?: boolean;
}

/**
 * Strips a recognized delimiter and returns the inner content verbatim (no
 * trim; a non-blank payload survives byte-for-byte).
 *
 * With `expectedNames`, tag/bracket wrappers whose name does not match any of
 * the expected names are treated as payload and returned unchanged — this is
 * what keeps prose such as `<note>x</note>` from being deleted by mistake.
 * Markdown headers are stricter (D7): they strip only on a name match even in
 * the legacy path, and a foreign-named header falls back to separator
 * handling on the full text, so a trailing `---` stays strippable while the
 * header itself is never deleted. Separator stripping is conservative by
 * default whenever the caller names wrappers, because a trailing `---` is
 * indistinguishable from a scene break.
 */
export function unwrapContent(content: string, options: UnwrapOptions = {}): string {
  const text = content ?? '';
  const detected = detectDelimiter(text);
  const { expectedNames, stripSeparator = expectedNames === undefined } = options;
  switch (detected.style) {
    case 'tag':
      if (expectedNames && !delimiterNameMatches(detected.name, expectedNames)) {
        return text;
      }
      return TAG_RE.exec(text)?.[2] ?? text;
    case 'bracket':
      if (expectedNames && !delimiterNameMatches(detected.name, expectedNames)) {
        return text;
      }
      return BRACKET_RE.exec(text)?.[2] ?? text;
    case 'markdown': {
      // The markdown strip never extends the dialog's accepted-detected-name
      // rule: only a header matching `expectedNames` is replaceable.
      const markdown = matchMarkdownShape(text);
      if (!markdown) {
        return text;
      }
      if (expectedNames && !delimiterNameMatches(markdown.name, expectedNames)) {
        // Foreign header: separator handling still applies to the full text,
        // so re-wrapping to `separator` cannot emit a second `---`.
        return stripSeparator ? (SEPARATOR_RE.exec(text)?.[1] ?? text) : text;
      }
      const inner = markdown.payload;
      return stripSeparator ? (SEPARATOR_RE.exec(inner)?.[1] ?? inner) : inner;
    }
    case 'separator':
      return stripSeparator ? (SEPARATOR_RE.exec(text)?.[1] ?? text) : text;
    // Cased, not `default`: with every member handled, a future `DelimiterStyle`
    // added without an arm here is a compile error (strict return checking),
    // never a silent fallthrough to identity.
    case 'none':
      return text;
  }
}

/**
 * Applies `style` to content that may already carry another delimiter.
 *
 * The existing wrapper is stripped first when the caller accepts its name
 * (`expectedNames`). Separator handling is deliberate:
 * - targeting `'separator'`/`'none'` strips a detected trailing `---`
 *   (explicit removal / re-apply);
 * - targeting `'markdown'` also consumes a trailing `---` in both toggle
 *   states — ON re-emits exactly one canonical marker (normalizing level and
 *   spacing), OFF removes the old marker — including one that surfaced from a
 *   stripped tag/bracket wrapper, so the toggle can never double markers;
 * - when a markdown **wrapper is detected** in the current content, its
 *   trailing `---` is the style's own toggle marker, not payload: switching
 *   to any target consumes it (a tag/bracket re-wrap writes the clean payload
 *   only). A foreign-named header keeps D7's protection — the header text
 *   stays payload — but its wrapper's marker is still consumed;
 * - any other trailing `---` (bare separator-detected prose, a marker inside
 *   a tag/bracket payload) is kept: a scene break must never be silently
 *   deleted by re-wrapping (the Phase-1 D4 guard).
 *
 * Malformed or unrecognized input degrades to additive wrapping, never
 * truncation; re-applying a wrapping style is a fixed point.
 */
export function rewrapContent(
  content: string,
  style: DelimiterStyle,
  name = '',
  expectedNames?: readonly string[],
  options?: MarkdownWrapOptions,
): string {
  const fromMarkdown = detectDelimiter(content).style === 'markdown';
  const stripSeparator =
    style === 'none' || style === 'separator' || style === 'markdown' || fromMarkdown;
  let inner = unwrapContent(content, { expectedNames, stripSeparator });
  // The tag/bracket strips ignore `stripSeparator` (scene-break protection),
  // so a marker surfacing from a stripped wrapper reaches here verbatim; a
  // markdown target consumes it before deciding on its own toggle marker.
  if (style === 'markdown') {
    inner = stripTrailingSeparatorRun(inner);
  }
  return style === 'none' ? inner : wrapContent(inner, style, name, options);
}

/**
 * Malformed whole-content wrappers.
 *
 * Wrapper-shaped content the well-formed regexes above deliberately reject:
 * a mismatched pair (`<test>\nlore\n</universe>`), an opening tag alone on
 * the first line (`<universe>\nlore`), a closing tag alone on the last line
 * (`lore\n</universe>`), an unclosed bracket (`[Name=\nlore`), or a broken
 * ATX opener (`##\n\nlore`, `#Name\nlore`). Detection
 * is additive and read-only — well-formed wrappers and separators are never
 * malformed, prose never classifies, and nothing here mutates content.
 * Callers preview a cleanup through the normal delimiter flow instead of
 * nesting fresh wrappers around the broken markup.
 */

/**
 * A malformed whole-content wrapper. Names are reported exactly as captured
 * (raw, case preserved), so a case-difference pair such as `<Test>…</test>`
 * keeps both spellings. The markdown shells report the heading depth of an
 * empty opener and the header text of a glue-typed opener respectively.
 */
export type MalformedWrapper =
  | { kind: 'mismatched'; openingName: string; closingName: string }
  | { kind: 'orphan-open'; name: string }
  | { kind: 'orphan-close'; name: string }
  | { kind: 'empty-header'; level: MarkdownHeadingLevel }
  | { kind: 'no-space-header'; name: string };

/**
 * Malformed-wrapper shapes, mirroring the well-formed regexes above with the
 * pairing constraint relaxed or removed:
 *
 * - `MALFORMED_TAG_RE` swaps TAG_RE's `\1` backreference for an independent
 *   closer-name capture, so mismatched pairs match — including case-difference
 *   pairs the exact-case backreference cannot see. Equality of the raw names
 *   is re-checked in code.
 * - The orphan regexes require the opener/closer alone on the first/last
 *   line, with a real line terminator beside it.
 * - The markdown regexes capture a broken ATX opener alone on the first line
 *   (one structural blank line tolerated before the payload): hashes with no
 *   header text, or hashes glued to their text. The glued shape requires a
 *   non-`#` character right after the hash run — a 7+ hash run is ordinary
 *   prose, never an ATX shell.
 * - The line-shape helpers are deliberately uncapped (any name length), so
 *   oversized names resolve to null instead of a misleading orphan.
 */
const MALFORMED_TAG_RE = /^\s*<([^<>\n]{1,80})>\r?\n?([\s\S]*?)\r?\n?<\/([^<>\n]{1,80})>\s*$/;
const ORPHAN_OPEN_TAG_RE = /^\s*<([^<>\n]{1,80})>[ \t]*(?:\r\n|\n|\r)([\s\S]*)$/;
const ORPHAN_OPEN_BRACKET_RE = /^\s*\[([^\]\n=]{1,80})=[ \t]*(?:\r\n|\n|\r)([\s\S]*)$/;
const ORPHAN_CLOSE_TAG_RE = /^([\s\S]*?)(?:\r\n|\n|\r)[ \t]*<\/([^<>\n]{1,80})>\s*$/;
const EMPTY_HEADER_RE = /^[ \t]*(#{1,6})[ \t]*\r?\n(?:\r?\n)?([\s\S]*)$/;
const NO_SPACE_HEADER_RE = /^[ \t]*(#{1,6})([^#\s][^\r\n]*)\r?\n(?:\r?\n)?([\s\S]*)$/;
/** Content that begins with an opener line (blank leading lines tolerated). */
const OPENER_LINE_PREFIX_RE = /^\s*<[^<>\n]*>[ \t]*(?:\r\n|\n|\r)/;
/** A line consisting only of a tag closer (any name length). */
const CLOSER_LINE_RE = /^[ \t]*<\/[^<>\n]*>[ \t]*\r?$/;

/** Whether the last line of `text` (trailing whitespace ignored) is only a closer. */
function endsWithCloserLine(text: string): boolean {
  const lastLine = text
    .replace(/\s+$/, '')
    .split(/\r\n|\n|\r/)
    .pop();
  return CLOSER_LINE_RE.test(lastLine ?? '');
}

/** A recognized malformed shape plus the payload bytes its strip must keep. */
interface MalformedShape {
  malformed: MalformedWrapper;
  payload: string;
}

/**
 * Structural matcher shared by detection and stripping: every guard of the
 * malformed contract except the orphan hint gate. Returns null for anything
 * ambiguous — well-formed shapes, blank payloads, names that sanitize away or
 * exceed 80 characters. A false null is always safe; a false positive would
 * delete payload, so shapes resolve conservatively.
 */
function matchMalformedShape(text: string): MalformedShape | null {
  const mismatched = MALFORMED_TAG_RE.exec(text);
  if (mismatched) {
    const openingName = mismatched[1] ?? '';
    const payload = mismatched[2] ?? '';
    const closingName = mismatched[3] ?? '';
    // Raw, case-sensitive inequality: TAG_RE's exact-case backreference hides
    // `<Test>…</test>` from the well-formed detector, so such pairs must not
    // stay blind spots here; equal raw names are well-formed territory.
    if (
      openingName !== closingName &&
      payload.trim() !== '' &&
      sanitizeDelimiterName(openingName) !== '' &&
      sanitizeDelimiterName(closingName) !== ''
    ) {
      return { malformed: { kind: 'mismatched', openingName, closingName }, payload };
    }
    return null;
  }
  const orphanOpenTag = ORPHAN_OPEN_TAG_RE.exec(text);
  if (orphanOpenTag) {
    const name = orphanOpenTag[1] ?? '';
    const payload = orphanOpenTag[2] ?? '';
    // A trailing closer line belongs to the well-formed/mismatched guards (or
    // their oversized/blank nulls), never to an orphan opener.
    if (payload.trim() !== '' && sanitizeDelimiterName(name) !== '' && !endsWithCloserLine(text)) {
      return { malformed: { kind: 'orphan-open', name }, payload };
    }
    return null;
  }
  const orphanOpenBracket = ORPHAN_OPEN_BRACKET_RE.exec(text);
  if (orphanOpenBracket) {
    const name = orphanOpenBracket[1] ?? '';
    const payload = orphanOpenBracket[2] ?? '';
    // A trailing `]` (BRACKET_RE's closing anchor) is likewise never orphaned.
    if (payload.trim() !== '' && sanitizeDelimiterName(name) !== '' && !/\]\s*$/.test(text)) {
      return { malformed: { kind: 'orphan-open', name }, payload };
    }
    return null;
  }
  const orphanClose = ORPHAN_CLOSE_TAG_RE.exec(text);
  if (orphanClose) {
    const name = orphanClose[2] ?? '';
    const payload = orphanClose[1] ?? '';
    // A leading opener line belongs to the well-formed/mismatched guards.
    if (
      payload.trim() !== '' &&
      sanitizeDelimiterName(name) !== '' &&
      !OPENER_LINE_PREFIX_RE.test(text)
    ) {
      return { malformed: { kind: 'orphan-close', name }, payload };
    }
    return null;
  }
  // Markdown shells come last: the tag-family diagnoses above win when both
  // match structurally, so every pre-markdown classification is unchanged.
  const emptyHeader = EMPTY_HEADER_RE.exec(text);
  if (emptyHeader) {
    const hashes = emptyHeader[1] ?? '';
    const payload = emptyHeader[2] ?? '';
    // `##\n\n---` alone is a separator with the header as payload, not an
    // empty heading (mirrors the well-formed blank-payload guard).
    if (stripTrailingSeparatorRun(payload).trim() !== '') {
      return {
        malformed: { kind: 'empty-header', level: hashes.length as MarkdownHeadingLevel },
        payload,
      };
    }
    return null;
  }
  const noSpaceHeader = NO_SPACE_HEADER_RE.exec(text);
  if (noSpaceHeader) {
    const name = (noSpaceHeader[2] ?? '').trim();
    const payload = noSpaceHeader[3] ?? '';
    if (name !== '' && [...name].length <= 80 && stripTrailingSeparatorRun(payload).trim() !== '') {
      return { malformed: { kind: 'no-space-header', name }, payload };
    }
    return null;
  }
  return null;
}

/**
 * Classifies a malformed whole-content wrapper, or null.
 *
 * Additive over `detectDelimiter`: anything the well-formed detector
 * recognizes (tag, bracket, markdown, separator) is never malformed.
 * Mismatched pairs and empty headers fire without hints — a whole-content
 * `<test>…</universe>` span or an empty `##` opener is strictly less likely
 * to be innocent prose than the well-formed blocks the dialog already
 * replaces. Orphan openers/closers and glue-typed headers fire only when
 * their name matches one of `hints` (`delimiterNameMatches`,
 * case-insensitive, sanitized), so a lone `<div>` in code-ish prose or a
 * `#hashtag` line stays payload; undefined or empty hints disable them.
 * Call sites pass the entry-derived name chain.
 */
export function detectMalformedWrapper(
  content: string,
  hints?: readonly string[],
): MalformedWrapper | null {
  const text = content ?? '';
  // Guard 1: a well-formed wrapper or separator is never malformed.
  if (detectDelimiter(text).style !== 'none') {
    return null;
  }
  const shape = matchMalformedShape(text);
  if (!shape) {
    return null;
  }
  if (shape.malformed.kind === 'mismatched' || shape.malformed.kind === 'empty-header') {
    return shape.malformed;
  }
  // Orphans and glued headers are hint-gated: an unmatched lone tag or a
  // `#hashtag` in prose must stay payload.
  return delimiterNameMatches(shape.malformed.name, hints ?? []) ? shape.malformed : null;
}

/**
 * Compact badge label for a malformed wrapper, e.g. `<test> ? </universe>`,
 * `<universe> ?`, `? </universe>`, `## ?`, or `#Name ?` — the shell a cleanup
 * will touch.
 */
export function malformedWrapperLabel(malformed: MalformedWrapper): string {
  switch (malformed.kind) {
    case 'mismatched':
      return `<${malformed.openingName}> ? </${malformed.closingName}>`;
    case 'orphan-open':
      return `<${malformed.name}> ?`;
    case 'orphan-close':
      return `? </${malformed.name}>`;
    case 'empty-header':
      return `${'#'.repeat(malformed.level)} ?`;
    case 'no-space-header':
      // The capture keeps the text after the hash run (it is what hint
      // matching compares), so the compact badge prefixes one `#`.
      return `#${malformed.name} ?`;
  }
}

/**
 * Removes one outer malformed shell and returns the payload verbatim (no
 * trim — the lossless standard of `unwrapContent`). Mirrors the well-formed
 * unwraps: the shell's own leading whitespace, one structural newline after
 * the opener and before the closer, and trailing whitespace are consumed;
 * everything between survives byte-for-byte.
 *
 * Structural and hint-free: hint gating belongs to classification, so this
 * strips any recognized malformed shape — including orphan openers/closers
 * that `detectMalformedWrapper` only reports for a matching entry name.
 * Callers such as the delimiter dialog strip only rows that classified.
 * Identity for nullish input, well-formed delimiters, and anything that does
 * not match a malformed shell shape; exactly one shell is removed per call,
 * and a nested well-formed inner wrapper survives.
 */
export function stripMalformedWrapper(content: string): string {
  const text = content ?? '';
  // Guard 1: a well-formed wrapper or separator is left untouched.
  if (detectDelimiter(text).style !== 'none') {
    return text;
  }
  return matchMalformedShape(text)?.payload ?? text;
}

/** Options metadata for delimiter style selectors. */
export const DELIMITER_STYLE_OPTIONS: readonly {
  value: DelimiterStyle;
  label: string;
  hint: string;
}[] = [
  { value: 'tag', label: 'Tag — <Name> … </Name>', hint: 'XML-style block' },
  { value: 'bracket', label: 'Bracket — [Name= … ]', hint: 'Assignment-style block' },
  { value: 'markdown', label: 'Markdown — ## Name', hint: 'ATX heading, optional trailing ---' },
  { value: 'separator', label: 'Separator — ---', hint: 'Dashed line after the content' },
  { value: 'none', label: 'None — remove delimiters', hint: 'Strip any recognized wrapper' },
];

/**
 * Default delimiter name for an entry: comment, then name, then first key.
 */
export function entryDelimiterName(entry: {
  comment?: string;
  name?: string;
  keys?: string[];
}): string {
  const raw =
    entry.comment?.trim() || entry.name?.trim() || entry.keys?.find((k) => k.trim())?.trim() || '';
  return sanitizeDelimiterName(raw) || 'entry';
}

/**
 * Delimiter name taken from the entry's first primary key, falling back to
 * the default resolution (comment/name/first key) when the entry has no keys.
 */
export function entryDelimiterNameFromKey(entry: {
  comment?: string;
  name?: string;
  keys?: string[];
}): string {
  const key = entry.keys?.find((k) => k.trim()) ?? '';
  return sanitizeDelimiterName(key) || entryDelimiterName(entry);
}

/** Compact badge label for a detected delimiter (e.g. `<London>`, `## London`). */
export function delimiterLabel(detected: DetectedDelimiter): string {
  switch (detected.style) {
    case 'tag':
      return `<${detected.name}>`;
    case 'bracket':
      return `[${detected.name}=…]`;
    case 'markdown':
      return `${'#'.repeat(detected.level ?? 2)} ${detected.name}`;
    case 'separator':
      return '---';
    // Cased, not `default`: a future `DelimiterStyle` without an arm is a
    // compile error, never a silently empty label.
    case 'none':
      return '';
  }
}
