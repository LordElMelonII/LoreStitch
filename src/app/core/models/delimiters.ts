/**
 * Content delimiter helpers.
 *
 * SillyTavern lorebook entries commonly wrap their content so the model can
 * tell where one entry's block begins and ends. LoreStitch recognizes the
 * three conventions below, can strip them again, and can re-wrap content with
 * a different style or name:
 *
 *   tag:       <London>\ncontent\n</London>
 *   bracket:   [London=\ncontent]
 *   separator: content\n\n---
 *
 * Every operation is pure and total (no throws). `wrap` -> `unwrap` is
 * byte-lossless for non-blank payloads under `tag`/`bracket` (the wrapper's
 * own structural newlines are consumed while the payload — padding, CRLF,
 * quotes, `<>[]=`, regex metacharacters, Unicode/emoji/CJK — is captured
 * verbatim) and under `separator` for payloads that do not themselves end in
 * a blank line (a body that does is unavoidably indistinguishable from the
 * marker run; `rewrap` still fixes it to an idempotent canonical form).
 * Blank payloads are a no-op for every style, so no phantom wrapper is ever
 * written into an entry.
 */

export type DelimiterStyle = 'tag' | 'bracket' | 'separator' | 'none';

export interface DetectedDelimiter {
  style: DelimiterStyle;
  /** Tag or bracket name (empty for separator/none). */
  name: string;
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
 * Wraps already-delimiter-free content in the given style. The payload is
 * embedded verbatim (never trimmed); only blank payloads short-circuit.
 *
 * The wrapper name is sanitized (`sanitizeDelimiterName`), falling back to
 * `'entry'` when nothing usable remains. The `separator` style returns a bare
 * marker unchanged: `---` already is the separator form, so appending another
 * one would accumulate on every re-apply.
 */
export function wrapContent(
  content: string,
  style: Exclude<DelimiterStyle, 'none'>,
  name = '',
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
 * Separator stripping is conservative by default whenever the caller names
 * wrappers, because a trailing `---` is indistinguishable from a scene break.
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
    case 'separator':
      return stripSeparator ? (SEPARATOR_RE.exec(text)?.[1] ?? text) : text;
    default:
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
 * - targeting `'tag'`/`'bracket'` keeps a trailing `---` as payload, because
 *   a scene break must never be silently deleted by re-wrapping.
 *
 * Malformed or unrecognized input degrades to additive wrapping, never
 * truncation; re-applying a wrapping style is a fixed point.
 */
export function rewrapContent(
  content: string,
  style: DelimiterStyle,
  name = '',
  expectedNames?: readonly string[],
): string {
  const stripSeparator = style === 'none' || style === 'separator';
  const inner = unwrapContent(content, { expectedNames, stripSeparator });
  return style === 'none' ? inner : wrapContent(inner, style, name);
}

/** Options metadata for delimiter style selectors. */
export const DELIMITER_STYLE_OPTIONS: readonly {
  value: DelimiterStyle;
  label: string;
  hint: string;
}[] = [
  { value: 'tag', label: 'Tag — <Name> … </Name>', hint: 'XML-style block' },
  { value: 'bracket', label: 'Bracket — [Name= … ]', hint: 'Assignment-style block' },
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

/** Compact badge label for a detected delimiter (e.g. `<London>`, `---`). */
export function delimiterLabel(detected: DetectedDelimiter): string {
  switch (detected.style) {
    case 'tag':
      return `<${detected.name}>`;
    case 'bracket':
      return `[${detected.name}=…]`;
    case 'separator':
      return '---';
    default:
      return '';
  }
}
