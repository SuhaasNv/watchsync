// The toolbar icon's badge (US-116): the unread chat count, "9+" past nine. Dev builds show
// "DEV" while nothing is unread, so testers can tell the two installs apart.

export function badgeText(unread: number, channel: string): string {
  if (unread > 9) return "9+";
  if (unread > 0) return String(unread);
  return channel === "dev" ? "DEV" : "";
}
