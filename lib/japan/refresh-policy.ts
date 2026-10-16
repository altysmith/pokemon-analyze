export function nextRefreshDays(eventDate: string, checkedAt: string, incomplete: boolean): number | null {
  const age = Math.max(0, Math.floor((Date.parse(checkedAt) - Date.parse(eventDate + "T00:00:00Z")) / 86_400_000));
  if (!Number.isFinite(age)) throw new Error("Invalid refresh dates.");
  if (age <= 3) return 1;
  if (age <= 14) return incomplete ? 2 : 3;
  if (age <= 30) return incomplete ? 7 : 14;
  return incomplete ? 30 : null;
}
