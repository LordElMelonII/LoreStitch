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

/**
 * Escapes regex metacharacters for the oracle's whole-word pattern. ST
 * imports `escapeRegex` from utils.js (world-info.js:4, used at :356), which
 * is not vendored; this is ST's canonical metacharacter set
 * (`/ \ ^ $ * + ? . ( ) | [ ] { }`).
 */
function escapeRegExp(value: string): string {
  return value.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
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

  // #transformString (world-info.js:268-270) applied to both sides
  // (world-info.js:345-346).
  const caseSensitive = options.caseSensitive ?? false;
  const matchWholeWords = options.matchWholeWords ?? false;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const transformedKey = caseSensitive ? key : key.toLowerCase();

  if (matchWholeWords) {
    const keyWords = transformedKey.split(/\s+/);
    if (keyWords.length > 1) {
      // Multi-word keys keep substring semantics (world-info.js:352-353).
      return haystack.includes(transformedKey);
    }
    // Custom boundaries include punctuation-adjacent matches; JS `\W` treats
    // `_` as a word character (world-info.js:355-359).
    return new RegExp(`(?:^|\\W)(${escapeRegExp(transformedKey)})(?:$|\\W)`).test(haystack);
  }

  return haystack.includes(transformedKey);
}
