import { CharacterBook, createEmptyBook, createEmptyEntry } from '../models/lorebook.model';
import {
  computeTokenFootprint,
  estimateEntryTokens,
  estimateTokens,
  formatTokenCount,
} from './token-estimator';

describe('TokenEstimator', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty text', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('counts latin text at roughly four characters per token', () => {
      expect(estimateTokens('a'.repeat(35))).toBe(9); // ceil(35 / 4)
    });

    it('counts CJK characters at one token per character', () => {
      expect(estimateTokens('セイバー')).toBe(4);
      expect(estimateTokens('阿尔托莉雅')).toBe(5);
    });

    it('mixes CJK and latin runs additively', () => {
      // 3 CJK chars + 8 latin chars -> 3 + ceil(8/4) = 5
      expect(estimateTokens('セイバー saber')).toBe(5);
    });
  });

  describe('formatTokenCount', () => {
    it('renders small counts verbatim', () => {
      expect(formatTokenCount(0)).toBe('0');
      expect(formatTokenCount(999)).toBe('999');
    });

    it('abbreviates thousands without a trailing .0', () => {
      expect(formatTokenCount(1000)).toBe('1k');
      expect(formatTokenCount(1200)).toBe('1.2k');
    });

    it('rounds large counts to whole kilos', () => {
      expect(formatTokenCount(31_400)).toBe('31k');
    });
  });

  describe('estimateEntryTokens', () => {
    it('estimates only the content (keys and memos are never injected)', () => {
      const entry = createEmptyEntry(1);
      entry.content = 'a'.repeat(40); // 10 tokens
      // Enough mass to change the total if keys or the memo were summed in.
      entry.keys = ['b'.repeat(20)]; // would add 5 tokens
      entry.comment = 'c'.repeat(40); // would add 10 tokens
      expect(estimateEntryTokens(entry)).toBe(10);
    });
  });

  describe('computeTokenFootprint', () => {
    function bookWith(entries: { enabled: boolean; constant: boolean; content: string }[]): CharacterBook {
      const book = createEmptyBook('Fuyuki');
      book.entries = entries.map((e, index) => {
        const entry = createEmptyEntry(index);
        entry.enabled = e.enabled;
        entry.constant = e.constant;
        entry.content = e.content;
        return entry;
      });
      return book;
    }

    it('sums only enabled + constant entries', () => {
      const book = bookWith([
        { enabled: true, constant: true, content: 'a'.repeat(40) }, // 10
        { enabled: true, constant: false, content: 'a'.repeat(40) }, // ignored: normal
        { enabled: false, constant: true, content: 'a'.repeat(40) }, // ignored: disabled
      ]);
      const fp = computeTokenFootprint(book);
      expect(fp.constantCount).toBe(1);
      expect(fp.totalTokens).toBe(10);
    });

    it('sorts the items heaviest-first', () => {
      const book = bookWith([
        { enabled: true, constant: true, content: 'a'.repeat(20) }, // 5
        { enabled: true, constant: true, content: 'a'.repeat(80) }, // 20
      ]);
      const fp = computeTokenFootprint(book);
      expect(fp.items.map((item) => item.tokens)).toEqual([20, 5]);
    });

    it('reports budget usage and over-budget state', () => {
      const book = bookWith([{ enabled: true, constant: true, content: 'a'.repeat(40) }]);
      book.token_budget = 50;
      const fp = computeTokenFootprint(book);
      expect(fp.budget).toBe(50);
      expect(fp.usage).toBeCloseTo(0.2);
      expect(fp.overBudget).toBe(false);

      book.token_budget = 5;
      expect(computeTokenFootprint(book).overBudget).toBe(true);
    });

    it('has no usage without a budget', () => {
      const fp = computeTokenFootprint(bookWith([]));
      expect(fp.budget).toBeNull();
      expect(fp.usage).toBeNull();
      expect(fp.overBudget).toBe(false);
      expect(fp.items).toEqual([]);
    });
  });
});
