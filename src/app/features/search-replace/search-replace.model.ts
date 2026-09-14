/** Payload handed to `SearchReplaceDialog`. */
export interface SearchReplaceDialogData {
  activeEntryId: number | null;
}

/** Hit counts per searchable field of an entry. */
export interface FieldHits {
  content: number;
  keys: number;
  names: number;
}

/** One preview row of the search & replace batch. */
export interface MatchRow {
  entryId: number;
  title: string;
  hits: FieldHits;
  total: number;
  /** Replacement result per field, only for fields with hits. */
  nextContent: string | null;
  nextKeys: string[] | null;
  nextName: string | null;
  changed: boolean;
}

/** Escapes a literal string for use inside `new RegExp`. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds the dialog's search regex, or null when the pattern is invalid. */
export function compileSearchPattern(options: {
  query: string;
  regexMode: boolean;
  wholeWord: boolean;
  matchCase: boolean;
}): RegExp | null {
  const { query, regexMode, wholeWord, matchCase } = options;
  if (!query) {
    return null;
  }
  let body = regexMode ? query : escapeRegExp(query);
  if (wholeWord) {
    body = `\\b(?:${body})\\b`;
  }
  try {
    return new RegExp(body, matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
}
