import type {
  CharacterBook,
  CharacterBookEntry,
} from '../models/lorebook.model';
import { entryTitle, entryTriggerState } from '../models/lorebook.model';

/**
 * Token estimation utilities.
 *
 * SillyTavern injects lorebook entries into a strictly budgeted prompt
 * context, but ships no tokenizer to the client — authors need a fast,
 * dependency-free estimate to spot context blowouts before a chat starts.
 * These functions are pure and deterministic so they are safe inside
 * `computed()` signal graphs and unit-testable in isolation.
 */

/**
 * CJK characters (Han, Hiragana, Katakana, Hangul) tokenize at roughly one
 * token per character in GPT-family BPE vocabularies, versus ~4 characters
 * per token for latin script.
 */
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Estimates the token count of a text: one token per CJK character plus the
 * remaining characters at the standard ~4 chars/token heuristic.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK_CHAR.test(char)) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk + other / 4);
}

/** Compact token label for meters and chips: `950`, `1.2k`, `31k`. */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  if (tokens < 10_000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Tokens a single entry contributes when activated. SillyTavern injects the
 * entry content only — keys, memos and filters never reach the prompt — so
 * the estimate covers `content` alone.
 */
export function estimateEntryTokens(entry: CharacterBookEntry): number {
  return estimateTokens(entry.content ?? '');
}

/** One always-active entry's share of the constant token footprint. */
export interface TokenFootprintItem {
  entryId: number;
  title: string;
  tokens: number;
}

/** Aggregate "always active token footprint" of a book. */
export interface TokenFootprint {
  /** Sum of tokens across enabled + constant entries. */
  totalTokens: number;
  /** How many enabled + constant entries make up the total. */
  constantCount: number;
  /** The contributing entries, heaviest first. */
  items: TokenFootprintItem[];
  /** The book's configured `token_budget`, or null when unset. */
  budget: number | null;
  /** `totalTokens / budget` (0..n) when a budget is set, else null. */
  usage: number | null;
  /** True when a budget is set and the footprint exceeds it. */
  overBudget: boolean;
}

/**
 * Computes the book's always-active footprint: entries that are enabled and
 * `constant` are injected into every generation regardless of keys, so their
 * combined token count is the minimum context cost before a chat begins.
 * (Vectorized entries are embedding-triggered, never unconditional.)
 */
export function computeTokenFootprint(book: CharacterBook): TokenFootprint {
  const items: TokenFootprintItem[] = [];
  book.entries.forEach((entry, index) => {
    if (!entry.enabled || entryTriggerState(entry) !== 'constant') {
      return;
    }
    items.push({
      entryId: entry.id ?? index,
      title: entryTitle(entry),
      tokens: estimateEntryTokens(entry),
    });
  });
  items.sort((a, b) => b.tokens - a.tokens);

  const totalTokens = items.reduce((sum, item) => sum + item.tokens, 0);
  const budget = typeof book.token_budget === 'number' ? book.token_budget : null;
  return {
    totalTokens,
    constantCount: items.length,
    items,
    budget,
    usage: budget && budget > 0 ? totalTokens / budget : null,
    overBudget: budget !== null && budget > 0 && totalTokens > budget,
  };
}
