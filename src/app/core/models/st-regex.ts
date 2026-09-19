/**
 * SillyTavern slash-delimited key regexes.
 *
 * Framework-free, pure port of `parseRegexFromString`
 * (sillytaver-world-info-doc/world-info.js:2821). A World Info key is treated
 * as a regex by SillyTavern only when it is written as `/body/flags` with the
 * inner `/` characters of the body escaped; anything else — including a key
 * that has the delimiter shape but would not compile — is silently ignored by
 * ST and yields `null` here. That silence is a detectable defect class, which
 * is why shape (`isRegexShapedKey`) and validity (`isValidStRegex`) are
 * reported separately.
 *
 * Line references below cite the vendored oracle; the vendored tree is the
 * test oracle for this module.
 */

/** A successfully parsed ST key regex. */
export interface StRegex {
  /** Regex body after the oracle's `\/` unescaping (world-info.js:2838). */
  source: string;
  /** Flags exactly as written in the key (world-info.js:2828) — never normalized. */
  flags: string;
  /**
   * Compiled pattern. A fresh object is returned per parse, mirroring ST,
   * which parses per `matchKeys` call (world-info.js:339) — so `g`/`y`
   * `lastIndex` state can never leak between calls.
   */
  regex: RegExp;
}

/**
 * The oracle's delimiter shape: non-empty body (`[\w\W]` so newlines are
 * allowed), zero or more of the six flags ST accepts — note `d` and `v` are
 * valid JavaScript flags that ST does not accept (world-info.js:2823).
 */
const ST_REGEX_SHAPE = /^\/([\w\W]+?)\/([gimsuy]*)$/;

/**
 * The oracle's unescaped-delimiter gate: any `/` not immediately preceded by
 * a backslash rejects the key (world-info.js:2833). ST's check is a raw
 * character test and does not understand escaped backslashes (`\\/` before
 * `/` passes); ported as-is.
 */
const UNESCAPED_SLASH = /(^|[^\\])\//;

/**
 * Faithful port of `parseRegexFromString` (world-info.js:2821-2846).
 * Returns `null` when the key is not `/body/flags`-shaped, contains an
 * unescaped inner `/`, or would not compile.
 */
export function parseStRegex(key: string): StRegex | null {
  const match = ST_REGEX_SHAPE.exec(key);
  if (!match) {
    return null;
  }
  // Capture groups may be absent under noUncheckedIndexedAccess; the shape
  // regex guarantees both matched, so the fallbacks are unreachable.
  const pattern = match[1] ?? '';
  const flags = match[2] ?? '';

  if (UNESCAPED_SLASH.test(pattern)) {
    return null;
  }

  // The oracle unescapes only the FIRST `\/` (String#replace with a string
  // needle, world-info.js:2838). Later `\/` stay escaped, which is harmless:
  // `\/` is a valid identity escape in JS regex bodies.
  const source = pattern.replace('\\/', '/');

  try {
    return { source, flags, regex: new RegExp(source, flags) };
  } catch {
    // ST silently ignores invalid regexes (world-info.js:2841-2845).
    return null;
  }
}

/**
 * True when the key has the ST `/body/flags` delimiter shape (the oracle's
 * first format gate, world-info.js:2823) even when the body would not
 * compile. Keys failing only the unescaped-inner-slash gate
 * (world-info.js:2833) are still shaped here; `isValidStRegex` applies the
 * full ST gate, so such keys parse to `null` and can be surfaced as
 * silently-ignored regex attempts.
 */
export function isRegexShapedKey(key: string): boolean {
  return ST_REGEX_SHAPE.test(key);
}

/** True when ST would accept the key as a regex: shaped AND compiling. */
export function isValidStRegex(key: string): boolean {
  return parseStRegex(key) !== null;
}

/**
 * True when the ST key regex matches `text`. `false` when the key is not a
 * valid ST regex (ST then treats it as plaintext, never as a regex) or the
 * test itself throws. The regex is parsed fresh per call, so stateful flags
 * (`g`, `y`) behave identically on every call — the `matchKeys` contract at
 * world-info.js:337-342.
 */
export function matchStRegex(key: string, text: string): boolean {
  const parsed = parseStRegex(key);
  if (!parsed) {
    return false;
  }
  try {
    return parsed.regex.test(text);
  } catch {
    return false;
  }
}
