/**
 * Play order of the built-in levels. The id is a level's stable identity (file name, tests, ?level= links);
 * its position lives separately in levels/order.json so reordering never renames files.
 */
export const ORDER_FILE = 'order.json';

/** Sort by the order list; levels it does not mention go after it, by id. Unknown ids in the list are ignored. */
export function applyOrder<T extends { id: string }>(items: T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(a.id) ?? Infinity;
    const rb = rank.get(b.id) ?? Infinity;
    return ra !== rb ? ra - rb : a.id.localeCompare(b.id);
  });
}

/** Parse order.json leniently: anything that is not an array of strings counts as no order. */
export function parseOrder(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/** The order after a level's id changed from `from` to `to`: same position, new id. Returns null when nothing changes. */
export function renameInOrder(order: readonly string[], from: string, to: string): string[] | null {
  return from !== to && order.includes(from) ? order.map((id) => (id === from ? to : id)) : null;
}
