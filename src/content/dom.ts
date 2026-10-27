// Adds, updates or (with empty css) removes one of our style tags.
export function injectStyle(id: string, css: string): void {
  let style = document.getElementById(id);
  if (!css) return style?.remove();
  if (!style) {
    const root = document.head ?? document.documentElement;
    if (!root) return;
    style = document.createElement("style");
    style.id = id;
    root.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

// Pages can set their own inline overflow; put back exactly what was there.
let savedOverflow: string | null = null;

export function lockScroll(locked: boolean): void {
  const root = document.documentElement;
  if (!root) return;
  if (locked && savedOverflow === null) {
    savedOverflow = root.style.overflow;
    root.style.overflow = "hidden";
  } else if (!locked && savedOverflow !== null) {
    root.style.overflow = savedOverflow;
    savedOverflow = null;
  }
}
