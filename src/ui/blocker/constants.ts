import type { BlockingMode } from "../../lib/types";

export const MODE_OPTIONS: { value: BlockingMode; label: string }[] = [
  { value: "usage", label: "Usage Based" },
  { value: "time", label: "Time Based" },
  { value: "on-open", label: "On each open" },
];

export const MODE_LABEL: Record<BlockingMode, string> = {
  usage: "Usage Based",
  time: "Time Based",
  "on-open": "On each open",
};

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
