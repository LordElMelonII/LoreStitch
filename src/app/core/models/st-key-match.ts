/**
 * SillyTavern World Info key matching for a single key against a text
 * haystack — pure, framework-free port of `WorldInfoBuffer.matchKeys`
 * (sillytaver-world-info-doc/world-info.js:337).
 *
 * Resolution contract: ST resolves entry-level overrides against the global
 * settings with `entry.value ?? global` (`caseSensitive`: world-info.js:269,
 * `matchWholeWords`: world-info.js:347) and both globals default to `false`
 * (world-info.js:77-78). The caller owns that entry-vs-global resolution;
 * this module treats `null`/`undefined` options as ST's defaults (`false`).
 *
 * Line references cite the vendored oracle; the vendored tree is the test
 * oracle for this module.
 */

import { parseStRegex } from './st-regex';

/** Entry-level matching overrides; `null`/`undefined` means unset (ST default). */
export interface StMatchOptions {
  /**
   * `case_sensitive` override. When falsy both sides are case-folded with
   * `String#toLowerCase` (the oracle's `#transformString`,
   * world-info.js:268-270).
   */
  caseSensitive?: boolean | null;
  /**
   * `match_whole_words` override. Single-word keys then require custom
   * boundaries; multi-word keys keep substring semantics
   * (world-info.js:349-363).
   */
  matchWholeWords?: boolean | null;
}

/** Half-open [start, end) span into the evaluated text. */
export interface StKeyMatchRange {
  /** Index of the first matched character. */
  start: number;
  /** Index one past the last matched character. */
  end: number;
}

/** The tri-state overrides resolved against ST's defaults (`false`). */
interface ResolvedStMatchOptions {
  caseSensitive: boolean;
  matchWholeWords: boolean;
}

/**
 * Evaluated-text cap for `findStKeyMatches` — the same bound the linter's
 * matcher applies to entry contents (`MATCH_CONTENT_CAP` in
 * `core/services/linter.ts`, Task 04 §3.1); bounds catastrophic-pattern cost
 * on huge texts.
 */
const MATCH_CONTENT_CAP = 5000;

/**
 * Per-key range cap for `findStKeyMatches` (Task 04 §3.1) — generous
 * headroom over the UI's 200-highlight clamp; stops the scans once a key
 * floods the evaluated text.
 */
const MAX_RANGES_PER_KEY = 500;

/**
 * Escapes regex metacharacters for the oracle's whole-word pattern. ST
 * imports `escapeRegex` from utils.js (world-info.js:4, used at :356), which
 * is not vendored; this is ST's canonical metacharacter set
 * (`/ \ ^ $ * + ? . ( ) | [ ] { }`).
 */
function escapeRegExp(value: string): string {
  return value.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/** The oracle's `#transformString` (world-info.js:268-270). */
function transformStString(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

/** Resolves the tri-state overrides; nullish means ST's default (`false`). */
function resolveStMatchOptions(options: StMatchOptions): ResolvedStMatchOptions {
  return {
    caseSensitive: options.caseSensitive ?? false,
    matchWholeWords: options.matchWholeWords ?? false,
  };
}

/**
 * Every `needle` occurrence in `haystack` as ranges — the range view of the
 * oracle's `String#includes` paths (world-info.js:353, 362) as an `indexOf`
 * loop, bounded by `MAX_RANGES_PER_KEY`.
 */
function collectSubstringRanges(haystack: string, needle: string): StKeyMatchRange[] {
  const ranges: StKeyMatchRange[] = [];
  let from = 0;
  while (ranges.length < MAX_RANGES_PER_KEY) {
    const found = haystack.indexOf(needle, from);
    // `indexOf('')` clamps past-the-end positions to the haystack length
    // instead of returning -1, so `found < from` catches that stall too.
    if (found === -1 || found < from) {
      return ranges;
    }
    ranges.push({ start: found, end: found + needle.length });
    // An empty needle matches at every index; advance at least one character
    // so the loop always progresses (the `includes('')` quirk, :362).
    from = found + Math.max(needle.length, 1);
  }
  return ranges;
}

/**
 * Ranges for the whole-word boundary scan (world-info.js:356). The oracle's
 * pattern is `(?:^|\W)(key)(?:$|\W)`; the port captures the leading boundary
 * and the key (`(?:^|(\W))(key)(?:$|\W)`) so the reported span can keep only
 * the key — captures never change what a pattern matches, so the boolean
 * contract of `matchStKey` is untouched. Runs on the case-folded haystack
 * with the folded key, exactly like the oracle.
 */
function collectWholeWordRanges(haystack: string, transformedKey: string): StKeyMatchRange[] {
  const boundary = new RegExp(`(?:^|(\\W))(${escapeRegExp(transformedKey)})(?:$|\\W)`, 'g');
  const ranges: StKeyMatchRange[] = [];
  while (ranges.length < MAX_RANGES_PER_KEY) {
    const match = boundary.exec(haystack);
    if (!match) {
      return ranges;
    }
    // Group 1 is undefined exactly when the zero-width `^` branch matched;
    // a `\W` boundary consumes exactly one character before the key. Group 2
    // is a required capture group, so the `?? ''` fallback (noUnchecked-
    // IndexedAccess) is unreachable for a successful exec.
    const start = match.index + (match[1] !== undefined ? 1 : 0);
    const end = start + (match[2] ?? '').length;
    ranges.push({ start, end });
    if (end === start) {
      // Only the empty key on the empty haystack can zero-length-match here;
      // the oracle's `.test` accepts it (world-info.js:356-360), so the
      // boolean keeps it — advance lastIndex by hand or the global loop
      // spins forever.
      boundary.lastIndex += 1;
    }
  }
  return ranges;
}

/**
 * The plaintext matching core shared by `matchStKey` and `findStKeyMatches`
 * (world-info.js:345-363): case-fold both sides (world-info.js:345-346,
 * 268-270); whole-word single-word keys report boundary-delimited key spans
 * (world-info.js:356), multi-word keys (world-info.js:350-353) and the
 * default path (world-info.js:362) keep substring semantics.
 *
 * Exported for hot-path callers (the linter's recursion pass) that fold key
 * and haystack once per pass instead of once per call: with
 * `caseSensitive: true` this function performs no folds itself, so passing
 * pre-folded inputs is observably identical to the `caseSensitive: false`
 * path. Callers that classify keys against ST's regex gate must run that
 * gate on the RAW key spelling — folding can change its verdict (e.g. the
 * flags of `/x/G` fold into the valid `/x/g`).
 */
export function findPlaintextRanges(
  key: string,
  text: string,
  caseSensitive: boolean,
  matchWholeWords: boolean,
): StKeyMatchRange[] {
  const haystack = transformStString(text, caseSensitive);
  const transformedKey = transformStString(key, caseSensitive);

  if (matchWholeWords) {
    // Multi-word keys keep substring semantics (world-info.js:352-353).
    if (transformedKey.split(/\s+/).length > 1) {
      return collectSubstringRanges(haystack, transformedKey);
    }
    // Custom boundaries include punctuation-adjacent matches; JS `\W` treats
    // `_` as a word character (world-info.js:355-359).
    return collectWholeWordRanges(haystack, transformedKey);
  }

  return collectSubstringRanges(haystack, transformedKey);
}

/**
 * Ranges for a valid ST key regex (world-info.js:338-342): flags containing
 * `g` yield every occurrence, otherwise the first match only. Zero-length
 * matches are skipped and `lastIndex` is advanced by hand, so a global scan
 * can never spin on `/(?:)/g`; a throwing `exec` yields no ranges.
 */
function collectRegexRanges(regex: RegExp, evaluatedText: string): StKeyMatchRange[] {
  const ranges: StKeyMatchRange[] = [];
  while (ranges.length < MAX_RANGES_PER_KEY) {
    let match: RegExpExecArray | null;
    try {
      match = regex.exec(evaluatedText);
    } catch {
      return [];
    }
    if (!match) {
      return ranges;
    }
    // match[0] is always defined for a successful exec; the ?? '' fallback
    // only satisfies noUncheckedIndexedAccess.
    const start = match.index;
    const end = start + (match[0] ?? '').length;
    if (end === start) {
      if (!regex.global) {
        return [];
      }
      regex.lastIndex += 1;
      continue;
    }
    ranges.push({ start, end });
    if (!regex.global) {
      return ranges;
    }
  }
  return ranges;
}

/**
 * True when `key` would activate against `text` under ST rules
 * (`matchKeys`, world-info.js:337-366):
 *
 * 1. Regex keys are tested first and override every other option
 *    (world-info.js:338-342). Keys that merely look regex-shaped but fail to
 *    parse fall through to plaintext matching.
 * 2. Plaintext matching case-folds both sides unless `caseSensitive`
 *    (world-info.js:345-346, 268-270).
 * 3. With `matchWholeWords`, a key splitting into more than one word on
 *    `/\s+/` matches by substring (`includes`, world-info.js:350-353); a
 *    single-word key must sit between start/end or non-word characters
 *    (world-info.js:356).
 * 4. Without `matchWholeWords`, substring matching (world-info.js:362).
 *
 * The oracle performs no trimming and no emptiness short-circuit — an empty
 * plaintext key matches everything via `includes('')` (and fails the
 * whole-word boundary pattern); ported as-is.
 */
export function matchStKey(key: string, text: string, options: StMatchOptions): boolean {
  // Regex first; it bypasses case/whole-word options (world-info.js:338-342).
  const keyRegex = parseStRegex(key);
  if (keyRegex) {
    return keyRegex.regex.test(text);
  }

  const { caseSensitive, matchWholeWords } = resolveStMatchOptions(options);
  return findPlaintextRanges(key, text, caseSensitive, matchWholeWords).length > 0;
}

/**
 * All ranges where `key` matches `text` under ST rules — the range-returning
 * counterpart of `matchStKey`, feeding excerpts and highlighted previews
 * (Task 04 §3.1; `matchKeys`, world-info.js:337-366):
 *
 * 1. A valid regex key yields its matches and overrides every option
 *    (world-info.js:338-342): flags containing `g` produce every occurrence,
 *    otherwise the first match only; zero-length matches are skipped. The
 *    regex is parsed fresh per call (the `parseStRegex` contract), so
 *    stateful flags reset every evaluation.
 * 2. Plain keys and invalid-regex-shaped keys go through the plaintext path
 *    with `matchStKey`'s exact rules; a whole-word single-word key reports
 *    the key's span, never the boundary characters.
 * 3. The evaluated text is capped at 5,000 characters — the same bound the
 *    linter's matcher applies (`MATCH_CONTENT_CAP` in
 *    `core/services/linter.ts`) — and ranges at 500 per key.
 *
 * Ranges index the evaluated text: `text` truncated to the cap and, when
 * `caseSensitive` is false, viewed through ST's `#transformString` case fold
 * (world-info.js:268-270). Ordinary prose folds length-stably, so offsets
 * coincide with the original text. Pure and deterministic; `matchStKey`
 * remains the boolean oracle.
 */
export function findStKeyMatches(
  key: string,
  text: string,
  options: StMatchOptions,
): readonly StKeyMatchRange[] {
  const evaluated = text.slice(0, MATCH_CONTENT_CAP);

  // Regex first, options ignored (world-info.js:338-342); invalid-regex
  // keys fall through to the plaintext path with the raw key string.
  const keyRegex = parseStRegex(key);
  if (keyRegex) {
    return collectRegexRanges(keyRegex.regex, evaluated);
  }

  const { caseSensitive, matchWholeWords } = resolveStMatchOptions(options);
  return findPlaintextRanges(key, evaluated, caseSensitive, matchWholeWords);
}
