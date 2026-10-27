import { siteCategory, siteName } from "./site";
import { addDays } from "./usage-timeline";
import { domainsForDays } from "./stats";
import type { DateKey, UsageHistory } from "./types";

// Mirrors Android generateAndExportCsv: the same sections, labels and layout,
// with the app columns swapped for their website equivalents.
export type CsvMode = "daily" | "total" | "both";

export const CSV_MODES: { value: CsvMode; label: string }[] = [
  { value: "daily", label: "Daily breakdown (time series)" },
  { value: "total", label: "Total summary" },
  { value: "both", label: "Both" },
];

const HEADER = "Date,Website,Domain,Category,Duration (ms),Duration (mins)\n";

function rows(usage: UsageHistory, keys: DateKey[], label: string): string {
  return domainsForDays(usage, keys)
    .filter((row) => row.ms > 0)
    .map((row) => {
      const name = siteName(row.domain).replaceAll(",", " ");
      return `${label},${name},${row.domain},${siteCategory(row.domain)},${Math.round(row.ms)},${Math.floor(row.ms / 60_000)}\n`;
    })
    .join("");
}

export function buildUsageCsv(usage: UsageHistory, start: DateKey, end: DateKey, mode: CsvMode): string {
  const days: DateKey[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  let csv = "";
  if (mode !== "total") {
    csv += "--- DAILY BREAKDOWN ---\n" + HEADER;
    for (const day of days) csv += rows(usage, [day], day);
    csv += "\n";
  }
  if (mode !== "daily") {
    csv += `--- TOTAL SUMMARY (${start} to ${end}) ---\n` + HEADER;
    csv += rows(usage, days, "TOTAL RANGE");
  }
  return csv;
}

export function csvFileName(start: DateKey): string {
  return `UsageData_${start}.csv`;
}
