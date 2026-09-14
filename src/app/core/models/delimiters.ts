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
 */

export type DelimiterStyle = 'tag' | 'bracket' | 'separator' | 'none';

export interface DetectedDelimiter {
  style: DelimiterStyle;
  /** Tag or bracket name (empty for separator/none). */
  name: string;
}

const TAG_RE = /^\s*<([^<>\n]{1,80})>[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*<\/\1>[ \t]*$/;
const BRACKET_RE = /^\s*\[([^\]\n=]{1,80})=[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*\][ \t]*$/;
const SEPARATOR_RE = /^([\s\S]+?)\r?\n[ \t]*-{3,}[ \t]*$/;

/** Recognizes which delimiter (if any) wraps the given content. */
export function detectDelimiter(content: string): DetectedDelimiter {
  const text = content ?? '';
  const tag = TAG_RE.exec(text);
  if (tag) {
    return { style: 'tag', name: tag[1].trim() };
  }
  const bracket = BRACKET_RE.exec(text);
  if (bracket) {
    return { style: 'bracket', name: bracket[1].trim() };
  }
  if (SEPARATOR_RE.test(text)) {
    return { style: 'separator', name: '' };
  }
  return { style: 'none', name: '' };
}

/** Wraps already-delimiter-free content in the given style. */
export function wrapContent(
  content: string,
  style: Exclude<DelimiterStyle, 'none'>,
  name = '',
): string {
  const body = (content ?? '').trim();
  const safeName = (name ?? '').trim() || 'entry';
  switch (style) {
    case 'tag':
      return `<${safeName}>\n${body}\n</${safeName}>`;
    case 'bracket':
      return `[${safeName}=\n${body}]`;
    case 'separator':
      return body ? `${body}\n---` : '---';
  }
}

/** Strips a recognized delimiter and returns the inner content. */
export function unwrapContent(content: string): string {
  const text = content ?? '';
  const detected = detectDelimiter(text);
  switch (detected.style) {
    case 'tag':
      return (TAG_RE.exec(text)?.[2] ?? text).trim();
    case 'bracket':
      return (BRACKET_RE.exec(text)?.[2] ?? text).trim();
    case 'separator':
      return (SEPARATOR_RE.exec(text)?.[1] ?? text).trim();
    default:
      return text;
  }
}

/**
 * Applies `style` to content that may already carry another delimiter:
 * the existing wrapper is stripped first, so switching between styles and
 * removing delimiters are all safe, idempotent operations.
 */
export function rewrapContent(content: string, style: DelimiterStyle, name = ''): string {
  const inner = unwrapContent(content);
  if (style === 'none') {
    return inner;
  }
  return wrapContent(inner, style, name);
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

/** Collapses characters that would break the wrapping syntax to spaces. */
function cleanDelimiterName(raw: string): string {
  return raw
    .replace(/[<>=[\]\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

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
  return cleanDelimiterName(raw) || 'entry';
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
  return cleanDelimiterName(key) || entryDelimiterName(entry);
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
