import { update } from "../lib/storage";
import { dateKey } from "../lib/time";

// Counts an open each time the tracked site changes. Passing null means no site
// is tracked, so coming back to the same site later counts again.
export async function noteOpen(domain: string | null): Promise<void> {
  const last = domain ?? "";
  await update("opens", (opens) => {
    if (opens.last === last) return opens;
    const key = dateKey();
    const today = { ...opens.days[key] };
    if (domain) today[domain] = (today[domain] ?? 0) + 1;
    return { last, days: { [key]: today } };
  }).catch(() => undefined);
}
