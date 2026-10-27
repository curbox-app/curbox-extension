import { browser } from "#imports";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { DateKey, Settings, UsageHistory } from "../lib/types";
import { msToWidget, todayKey } from "../lib/time";
import { allDomains, dayTotal, domainsForDays, type DomainRow } from "../lib/stats";
import { ASCII_NAMES, asciiFor, asciiLabel } from "../lib/ascii";
import { siteCategory, siteName } from "../lib/site";
import {
  datesIn,
  defaultSelectedIndex,
  formatRange,
  navigationStep,
  periods,
  totalLabel,
  weekOffsetFor,
  weekStart,
  type ChartScale,
  type UsagePeriod,
} from "../lib/usage-timeline";
import { CSV_MODES, buildUsageCsv, csvFileName } from "../lib/usage-csv";
import { EditorSheet, SheetActions, inputCls } from "./components";

type UsagePrefs = Pick<Settings, "usageIgnoredSites" | "usageBackgroundArt">;
type Sheet = "art" | "ignored" | "export" | null;

function AsciiWatermark({ ascii, compact }: { ascii: string; compact?: boolean }) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-0 flex items-start justify-start overflow-hidden ${compact ? "h-[220px]" : "h-[380px]"}`}
      style={{
        maskImage: "linear-gradient(to bottom, #000 42%, transparent 96%)",
        WebkitMaskImage: "linear-gradient(to bottom, #000 42%, transparent 96%)",
      }}
    >
      <pre
        aria-hidden="true"
        className="m-0 w-max select-none whitespace-pre text-left font-mono text-[7px] leading-[0.85] text-faint opacity-80"
      >
        {ascii}
      </pre>
    </div>
  );
}

function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="font-display grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tertiary-chip text-lg leading-none text-ink">
        {domain[0]?.toUpperCase() ?? "?"}
      </span>
    );
  }
  const base = (browser.runtime.getURL as (p: string) => string)("/_favicon/");
  const src = `${base}?pageUrl=${encodeURIComponent(`https://${domain}`)}&size=64`;
  return (
    <img
      src={src}
      alt=""
      width={40}
      height={40}
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-full bg-tertiary-chip object-cover"
    />
  );
}

function UsageMenu({
  weekly,
  onWeekly,
  onOpen,
}: {
  weekly: boolean;
  onWeekly: () => void;
  onOpen: (sheet: Exclude<Sheet, null>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const item = (label: string, action: () => void, checked?: boolean) => (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={() => {
        setOpen(false);
        action();
      }}
      className="flex w-full items-center justify-between gap-6 px-4 py-3 text-left text-sm text-ink transition-colors hover:bg-state"
    >
      {label}
      {checked !== undefined && (
        <span className={`grid h-4 w-4 place-items-center rounded border ${checked ? "border-primary bg-primary text-on-primary" : "border-faint"}`}>
          {checked && "✓"}
        </span>
      )}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Usage options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-10 w-10 place-items-center rounded-full text-muted transition-colors hover:bg-state hover:text-ink"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-[var(--radius-card)] bg-card py-1 shadow-float">
          {item("Weekly usage", onWeekly, weekly)}
          {item("Select background art", () => onOpen("art"))}
          {item("Select ignored websites", () => onOpen("ignored"))}
          {item("Export data as CSV", () => onOpen("export"))}
        </div>
      )}
    </div>
  );
}

function BarGraph({
  list,
  totals,
  selected,
  onSelect,
}: {
  list: UsagePeriod[];
  totals: number[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const max = Math.max(1, ...totals);
  const barArea = 118;
  return (
    <div className="flex h-[168px] flex-col px-[12%]">
      <div className="flex flex-1 items-end justify-between">
        {list.map((period, i) => {
          const height = totals[i] > 0 ? Math.max(8, Math.round((totals[i] / max) * barArea)) : 0;
          return (
            <button
              key={period.start}
              onClick={() => onSelect(i)}
              aria-label={`${formatRange(period.start, period.end)} ${msToWidget(totals[i])}`}
              className="flex h-full flex-1 items-end justify-center"
            >
              <span style={{ height }} className="w-[15px] rounded-[8px] bg-accent transition-all duration-300 ease-out" />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between">
        {list.map((period, i) => (
          <span
            key={period.start}
            className={`flex-1 whitespace-nowrap text-center text-[11px] ${i === selected ? "font-semibold text-ink" : "text-muted"}`}
          >
            {period.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function pathLabel(path: string): string {
  if (path === "/" || path === "") return "Home";
  return path;
}

// Right click, or a long press on touch, offers to ignore the site, like the
// long press on an Android usage row.
function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      fired.current = false;
      if (e.pointerType !== "touch") return;
      timer.current = setTimeout(() => {
        fired.current = true;
        onLong();
      }, 500);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      cancel();
      if (!fired.current) onLong();
      fired.current = true;
    },
    onClickCapture: (e: MouseEvent) => {
      if (fired.current) e.stopPropagation();
      fired.current = false;
    },
  };
}

function DomainItem({ row, onIgnore }: { row: DomainRow; onIgnore: (domain: string) => void }) {
  const extra = row.paths.filter((p) => p.path !== "/");
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const longPress = useLongPress(() => onIgnore(row.domain));
  const thread = extra.length > 0 ? extra : row.paths;
  const shown = showAll ? thread : thread.slice(0, 5);
  const hidden = thread.length - shown.length;
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-3.5 py-3 text-left"
        aria-expanded={extra.length > 0 ? open : undefined}
        onClick={() => extra.length > 0 && setOpen((v) => !v)}
        {...longPress}
      >
        <Favicon domain={row.domain} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-ink">{siteName(row.domain)}</span>
          <span className="mt-px text-[11px] uppercase tracking-[0.06em] text-faint">{siteCategory(row.domain)}</span>
        </span>
        <span className="tnum shrink-0 text-sm text-muted">{msToWidget(row.ms)}</span>
        {extra.length > 0 && (
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 text-faint transition ${open ? "rotate-90" : ""}`}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        )}
      </button>
      {open && extra.length > 0 && (
        <div className="-mt-1 flex flex-col pb-2 pl-[54px] pr-1">
          {shown.map((p, i) => {
            const last = i === shown.length - 1 && hidden === 0;
            return (
              <p key={p.path} className="truncate py-1 text-xs text-faint">
                {last ? "└" : "├"}&nbsp;&nbsp;{pathLabel(p.path)} • {msToWidget(p.ms)}
              </p>
            );
          })}
          {hidden > 0 && (
            <button type="button" onClick={() => setShowAll(true)} className="py-1 text-left text-xs text-primary">
              └&nbsp;&nbsp;See more pages
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DomainList({ rows, emptyMessage, onIgnore }: { rows: DomainRow[]; emptyMessage: string; onIgnore: (domain: string) => void }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="h-2 w-2 animate-pulse rounded-full bg-faint" />
        <p className="text-sm text-muted">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <DomainItem key={row.domain} row={row} onIgnore={onIgnore} />
      ))}
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={dir === "right" ? "rotate-180" : ""}>
      <path d="M14.5 6.5 8.5 12l6 5.5" />
    </svg>
  );
}

function ArtSheet({
  selected,
  onPreview,
  onSave,
  onClose,
}: {
  selected: string;
  onPreview: (name: string) => void;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState(selected);
  const choices = [{ name: "", label: "Random" }, ...ASCII_NAMES.map((name) => ({ name, label: asciiLabel(name) }))];
  return (
    <EditorSheet
      title="Background art"
      subtitle="Pick the art behind your usage."
      onClose={onClose}
      nav={<SheetActions onCancel={onClose} onOkay={() => onSave(choice)} />}
    >
      <div role="radiogroup" className="flex flex-col">
        {choices.map(({ name, label }) => (
          <button
            key={name || "random"}
            role="radio"
            aria-checked={choice === name}
            onClick={() => {
              setChoice(name);
              onPreview(name);
            }}
            className="flex items-center gap-3 border-b border-line/70 py-3 text-left text-sm"
          >
            <Radio on={choice === name} />
            {label}
          </button>
        ))}
      </div>
    </EditorSheet>
  );
}

function Radio({ on, square }: { on: boolean; square?: boolean }) {
  return (
    <span
      className={`grid h-5 w-5 shrink-0 place-items-center border-2 text-[11px] text-on-primary ${square ? "rounded-md" : "rounded-full"} ${
        on ? "border-primary bg-primary" : "border-faint"
      }`}
    >
      {on && square && "✓"}
    </span>
  );
}

function IgnoredSheet({
  usage,
  ignored,
  onSave,
  onClose,
}: {
  usage: UsageHistory;
  ignored: string[];
  onSave: (sites: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(ignored));
  const [query, setQuery] = useState("");
  const domains = useMemo(() => [...new Set([...ignored, ...allDomains(usage)])], [usage, ignored]);
  const q = query.trim().toLowerCase();
  const shown = domains.filter((d) => !q || d.includes(q) || siteName(d).toLowerCase().includes(q));
  const toggle = (domain: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(domain)) next.add(domain);
      return next;
    });
  return (
    <EditorSheet
      title="Ignored websites"
      subtitle="I won't show stats from the sites you pick."
      onClose={onClose}
      nav={<SheetActions onCancel={onClose} onOkay={() => onSave(domains.filter((d) => picked.has(d)))} />}
    >
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites" className={`${inputCls} mb-2`} />
      {shown.length === 0 && <p className="py-4 text-sm text-muted">No sites to show yet.</p>}
      <div className="flex flex-col">
        {shown.map((domain) => (
          <button
            key={domain}
            role="checkbox"
            aria-checked={picked.has(domain)}
            onClick={() => toggle(domain)}
            className="flex items-center gap-3 border-b border-line/70 py-2.5 text-left"
          >
            <Favicon domain={domain} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{siteName(domain)}</span>
              <span className="block truncate text-xs text-faint">{domain}</span>
            </span>
            <Radio on={picked.has(domain)} square />
          </button>
        ))}
      </div>
    </EditorSheet>
  );
}

function downloadText(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Android asks for a date range, then the format, and saves on the choice.
function ExportSheet({ usage, onClose }: { usage: UsageHistory; onClose: () => void }) {
  const today = todayKey();
  const [start, setStart] = useState(`${today.slice(0, 8)}01`);
  const [end, setEnd] = useState(today);
  const [step, setStep] = useState<"range" | "format">("range");
  const valid = !!start && !!end && start <= end;

  if (step === "format") {
    return (
      <EditorSheet title="Select data format" subtitle={formatRange(start, end)} onClose={onClose}>
        <div className="flex flex-col">
          {CSV_MODES.map((mode) => (
            <button
              key={mode.value}
              onClick={() => {
                downloadText(buildUsageCsv(usage, start, end, mode.value), csvFileName(start), "text/csv");
                onClose();
              }}
              className="flex items-center gap-3 border-b border-line/70 py-3 text-left text-sm"
            >
              <Radio on={false} />
              {mode.label}
            </button>
          ))}
        </div>
      </EditorSheet>
    );
  }

  return (
    <EditorSheet
      title="Select export range"
      subtitle="I keep the last four weeks of browsing."
      onClose={onClose}
      nav={<SheetActions onCancel={onClose} onOkay={() => valid && setStep("format")} okay="Next" />}
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          From
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className={`${inputCls} w-auto`} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          To
          <input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} className={`${inputCls} w-auto`} />
        </label>
        {!valid && <p className="text-xs text-muted">The start date needs to come before the end date.</p>}
      </div>
    </EditorSheet>
  );
}

function IgnoreConfirm({ domain, onOkay, onClose }: { domain: string; onOkay: () => void; onClose: () => void }) {
  return (
    <EditorSheet
      title="Ignore this website?"
      subtitle={`I'll stop showing any stats from ${siteName(domain)}.`}
      onClose={onClose}
      nav={<SheetActions onCancel={onClose} onOkay={onOkay} />}
    >
      <p className="text-sm text-muted">You can bring it back from Select ignored websites.</p>
    </EditorSheet>
  );
}

export function UsageView({
  usage,
  prefs,
  onChangePrefs,
  compact,
}: {
  usage: UsageHistory;
  prefs: UsagePrefs;
  onChangePrefs: (prefs: Partial<UsagePrefs>) => void;
  compact?: boolean;
}) {
  const today = todayKey();
  const [scale, setScale] = useState<ChartScale>("days");
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [ignoring, setIgnoring] = useState<string | null>(null);
  // What is on screen. Picking art previews it at once; cancelling restores the
  // saved choice, and saving keeps what was previewed, as on Android.
  const [ascii, setAscii] = useState(() => asciiFor(prefs.usageBackgroundArt));

  const ignored = prefs.usageIgnoredSites;

  const list = useMemo(() => periods(scale, weekStart(today, offset)), [scale, offset, today]);
  const selected = picked ?? defaultSelectedIndex(list, today);
  const period = list[selected];
  const totals = useMemo(
    () => list.map((p) => (p.start > today ? 0 : datesIn(p, today).reduce((sum, key) => sum + dayTotal(usage, key, ignored), 0))),
    [list, usage, ignored, today],
  );
  const rows = useMemo(() => domainsForDays(usage, datesIn(period, today), ignored), [usage, period, ignored, today]);
  const total = rows.reduce((sum, row) => sum + row.ms, 0);

  const move = (next: number) => {
    setOffset(next);
    setPicked(null);
  };
  const toggleWeekly = () => {
    if (scale === "weeks") move(weekOffsetFor(period, today));
    else setPicked(null);
    setScale(scale === "weeks" ? "days" : "weeks");
  };

  return (
    <div className="rise relative">
      <AsciiWatermark ascii={ascii} compact={compact} />
      <div className="relative z-10 px-4">
        <div className={`flex items-start justify-between ${compact ? "pt-6" : "pt-[100px]"}`}>
          <div>
            <p className="text-[11px] font-medium tracking-[0.04em] text-muted">{totalLabel(period, scale, today)}</p>
            <p className="font-display tnum mt-1 text-[56px] leading-none text-ink">{msToWidget(total)}</p>
          </div>
          <UsageMenu weekly={scale === "weeks"} onWeekly={toggleWeekly} onOpen={setSheet} />
        </div>
        <div className="mt-6">
          <BarGraph list={list} totals={totals} selected={selected} onSelect={setPicked} />
          <div className="mt-5 flex items-center py-2 text-ink">
            <button
              type="button"
              onClick={() => move(offset - navigationStep(scale))}
              aria-label={scale === "weeks" ? "Earlier weeks" : "Previous week"}
              className="grid h-12 w-10 place-items-center"
            >
              <Chevron dir="left" />
            </button>
            <span className="tnum flex-1 text-center text-sm">{formatRange(list[0].start, list[list.length - 1].end)}</span>
            <button
              type="button"
              onClick={() => move(Math.min(0, offset + navigationStep(scale)))}
              disabled={offset >= 0}
              aria-label={scale === "weeks" ? "Later weeks" : "Next week"}
              className="grid h-12 w-10 place-items-center disabled:opacity-25"
            >
              <Chevron dir="right" />
            </button>
          </div>
        </div>
        <div className="mt-6">
          <DomainList
            rows={rows}
            emptyMessage={period.start <= today && today <= period.end ? "Nothing yet today. Enjoy the quiet." : "No sites recorded then."}
            onIgnore={setIgnoring}
          />
        </div>
      </div>

      {ignoring && (
        <IgnoreConfirm
          domain={ignoring}
          onClose={() => setIgnoring(null)}
          onOkay={() => {
            if (!ignored.includes(ignoring)) onChangePrefs({ usageIgnoredSites: [...ignored, ignoring] });
            setIgnoring(null);
          }}
        />
      )}
      {sheet === "art" && (
        <ArtSheet
          selected={prefs.usageBackgroundArt}
          onPreview={(name) => setAscii(asciiFor(name))}
          onClose={() => {
            setAscii(asciiFor(prefs.usageBackgroundArt));
            setSheet(null);
          }}
          onSave={(usageBackgroundArt) => {
            onChangePrefs({ usageBackgroundArt });
            setSheet(null);
          }}
        />
      )}
      {sheet === "ignored" && (
        <IgnoredSheet
          usage={usage}
          ignored={ignored}
          onClose={() => setSheet(null)}
          onSave={(usageIgnoredSites) => {
            onChangePrefs({ usageIgnoredSites });
            setSheet(null);
          }}
        />
      )}
      {sheet === "export" && <ExportSheet usage={usage} onClose={() => setSheet(null)} />}
    </div>
  );
}
