/**
 * Pure fit math behind one entry row's key strip (`EntryKeys`): which whole
 * key chips fit the strip's width, and how many move into the `+N` counter.
 * Framework-free on purpose (house module-naming rule) — the DOM-facing
 * measurement lives in the component, and this module is exhaustively
 * table-tested without a browser.
 */

/**
 * Gap between the chips of a key strip, in px. `entry-keys.scss` keeps the
 * strip's flex `gap` in sync — the fit must count the same gaps the layout
 * actually renders.
 */
export const KEY_CHIP_GAP_PX = 4;

/** Decimal digit count of a non-negative integer (0 counts as one digit). */
export function digitsOf(n: number): number {
  if (n <= 0) {
    return 1;
  }
  return Math.floor(Math.log10(n)) + 1;
}

/**
 * Greedy left-to-right fit of whole key chips (task 21, round-3 contract):
 * never truncates a chip — it decides how many fit whole and leaves the rest
 * to the `+N` counter.
 *
 * `chipWidths` are the chips' full natural widths; `counterWidthFor` returns
 * the width the counter chip would occupy when it names `hiddenCount` keys
 * (wider for more digits). The result is the visible chip count; the hidden
 * count is `chipWidths.length - result` and is always >= 1 unless every chip
 * fits, in which case no counter renders at all.
 *
 * Each candidate count is checked against the width of its OWN counter — the
 * one that would name exactly the keys it hides — so a digit jump (hiding one
 * more chip widens `+9` into `+10`) resolves exactly here instead of needing
 * the caller to iterate. Candidates are scanned from the most chips down and
 * the first fitting row wins; when even chip 0 leaves no room for a counter,
 * 0 is returned and the counter leads the row naming every key (clipped if
 * it alone cannot fit — a degenerate strip narrower than its counter).
 */
export function fitKeyChips(
  containerWidth: number,
  chipWidths: readonly number[],
  gap: number,
  counterWidthFor: (hiddenCount: number) => number,
): number {
  const total = chipWidths.length;
  if (total === 0 || containerWidth <= 0) {
    return 0;
  }
  // Width the first `count` chips occupy once laid out: their full natural
  // widths plus the (count - 1) gaps between them.
  const span = (count: number): number => {
    let width = 0;
    for (let i = 0; i < count; i += 1) {
      width += chipWidths[i] ?? 0;
    }
    return width + gap * Math.max(0, count - 1);
  };

  // Everything fitting needs no counter — and none may be reserved, or the
  // reservation would hide chips that actually fit.
  if (span(total) <= containerWidth) {
    return total;
  }

  for (let count = total - 1; count >= 1; count -= 1) {
    // The trailing gap applies only here: with at least one chip visible the
    // counter follows a chip, while a counter-first row (count 0) renders
    // without a leading gap.
    if (span(count) + gap + counterWidthFor(total - count) <= containerWidth) {
      return count;
    }
  }
  return 0;
}
