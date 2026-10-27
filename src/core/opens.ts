import { get, set } from "../lib/storage";
import { dateKey } from "../lib/time";

let queue: Promise<void> = Promise.resolve();

// Counts an open each time the tracked site changes. Passing null means no site
// is tracked, so coming back to the same site later counts again.
export function noteOpen(domain: string | null): Promise<void> {
  queue = queue
    .then(async () => {
      const opens = await get("opens");
      const last = domain ?? "";
      if (opens.last === last) return;
      const key = dateKey();
      const today = { ...opens.days[key] };
      if (domain) today[domain] = (today[domain] ?? 0) + 1;
      await set("opens", { last, days: { [key]: today } });
    })
    .catch(() => {});
  return queue;
}
