/* ---------------------------------------------------------------------------
   Fractional ordering.

   Moving one row rewrites one row. The alternative — integer positions — means
   renumbering every sibling after the insertion point, which on a synced app
   turns a single drag into N dirty rows for the next push to carry.

   Floats do run out of precision if you repeatedly drop into the same gap, so
   `needsRebalance` flags when a list should be renumbered.
   --------------------------------------------------------------------------- */

/** Smallest gap tolerated before a list is renumbered. Doubles have ~15
 *  significant digits; bailing at 1e-6 leaves an enormous margin. */
const MIN_GAP = 1e-6

export const STEP = 1

/** Order value placing an item between two neighbours. Either may be
 *  undefined, meaning "no neighbour on that side". */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before == null && after == null) return 0
  if (before == null) return after! - STEP
  if (after == null) return before + STEP
  return (before + after) / 2
}

/** Order value that appends to a list. */
export function orderAtEnd(orders: number[]): number {
  return orders.length === 0 ? 0 : Math.max(...orders) + STEP
}

/** True when consecutive values have crowded together far enough that the next
 *  midpoint would start losing precision. */
export function needsRebalance(orders: number[]): boolean {
  const sorted = [...orders].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] < MIN_GAP) return true
  }
  return false
}

/** Evenly spaced integers for a list that has lost precision. */
export function rebalanced<T>(items: T[]): { item: T; order: number }[] {
  return items.map((item, i) => ({ item, order: i * STEP }))
}

/** Where a timed task belongs among its siblings, so a newly added task still
 *  lands in chronological order by default even though manual order wins after
 *  a drag. Untimed tasks go to the end. */
export function chronologicalIndex(
  siblings: { time: string; order: number }[],
  time: string,
): number {
  if (!time) return siblings.length
  const sorted = [...siblings].sort((a, b) => a.order - b.order)
  const index = sorted.findIndex((s) => !s.time || s.time > time)
  return index === -1 ? sorted.length : index
}
