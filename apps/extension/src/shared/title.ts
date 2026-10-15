/**
 * A title is its service and its ID: Netflix and JioHotstar both use numeric IDs, so an ID alone
 * can match a different title on another service (BUG-083). Compare two titles by comparing
 * their keys; no title (or no ID) has the key null.
 */
export function titleKey(
  x: { service: string; titleId: string | null } | null | undefined,
): string | null {
  return x && x.titleId !== null ? `${x.service}:${x.titleId}` : null;
}
