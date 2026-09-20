/**
 * Pure segment math behind the Test keys highlighted preview (Task 04
 * §3.3): turns per-key match ranges into ordered text spans with one tone
 * each, resolving overlaps deterministically so the preview can never
 * flicker between orderings.
 *
 * Framework-free by the core invariant — no Angular imports; the panel only
 * renders the returned segments.
 */

import { type StKeyMatchRange } from '../../../core/models/st-key-match';

/** Paint of one rendered preview segment. */
export type HighlightTone = 'none' | 'primary' | 'secondary';

/** One contiguous render span of the highlighted preview. */
export interface TextSegment {
  readonly text: string;
  readonly tone: HighlightTone;
}

/** One key's match ranges, tagged with the tone its hits paint. */
export interface KeyHighlightRanges {
  readonly tone: 'primary' | 'secondary';
  /** Ranges in document order, exactly as `findStKeyMatches` returned them. */
  readonly ranges: readonly StKeyMatchRange[];
}

/**
 * Rendered-highlight cap (Task 04 §3.3): only the first 200 matches (key
 * list order, then document order) are painted; the panel shows a
 * "Showing first 200 matches" note when the sample exceeds this.
 */
export const HIGHLIGHT_CLAMP = 200;

/** One candidate highlight before overlap resolution. */
interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly tone: 'primary' | 'secondary';
  /** Global discovery order: key list order, then document order. */
  readonly order: number;
}

/** Primary paints before secondary on equal spans (Task 04 §3.3). */
function toneRank(tone: 'primary' | 'secondary'): number {
  return tone === 'primary' ? 0 : 1;
}

/**
 * Splits `text` into spans for the read-only preview.
 *
 * Overlap resolution is deterministic and unit-pinned (Task 04 §3.3):
 * outermost range wins; ties → earlier start; equal spans → primary before
 * secondary, then key list order. Only the first `HIGHLIGHT_CLAMP` matches
 * (key list order, then document order) participate — the rest of the text
 * renders unpainted so the caption can honestly say "first 200".
 *
 * Pure; runs on the raw sample. `findStKeyMatches` returns ranges indexing
 * its evaluated text, whose offsets coincide with the raw sample for
 * length-stable case folds (the panel's documented assumption); out-of-range
 * spans are clamped defensively and never paint.
 */
export function highlightSegments(
  text: string,
  perKeyRanges: readonly KeyHighlightRanges[],
): readonly TextSegment[] {
  // 1. Flatten in (key list order, document order) and keep the first 200
  //    matches, clamping every span into the text.
  const candidates: Candidate[] = [];
  let order = 0;
  for (const keyRanges of perKeyRanges) {
    for (const range of keyRanges.ranges) {
      const start = Math.max(0, Math.min(range.start, text.length));
      const end = Math.max(0, Math.min(range.end, text.length));
      if (end <= start) {
        continue;
      }
      candidates.push({ start, end, tone: keyRanges.tone, order });
      order += 1;
      if (candidates.length >= HIGHLIGHT_CLAMP) {
        break;
      }
    }
    if (candidates.length >= HIGHLIGHT_CLAMP) {
      break;
    }
  }

  // 2. Winner order: outermost (longest span) first; ties → earlier start;
  //    equal spans → primary before secondary; then discovery order.
  candidates.sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start ||
      toneRank(a.tone) - toneRank(b.tone) ||
      a.order - b.order,
  );

  // 3. Paint greedily: each candidate claims only still-unclaimed indexes,
  //    so containment and the tie rules above decide every position once.
  const paint = new Map<number, 'primary' | 'secondary'>();
  for (const candidate of candidates) {
    for (let i = candidate.start; i < candidate.end; i += 1) {
      if (!paint.has(i)) {
        paint.set(i, candidate.tone);
      }
    }
  }

  // 4. Group consecutive indexes of one tone into segments; unpainted text
  //    renders as 'none' so the sample stays readable between highlights.
  const segments: TextSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const tone = paint.get(i) ?? 'none';
    let end = i + 1;
    while (end < text.length && (paint.get(end) ?? 'none') === tone) {
      end += 1;
    }
    segments.push({ text: text.slice(i, end), tone });
    i = end;
  }
  return segments;
}
