// What a page tells the background about a screenshot taken right after one of its events (docs/design.md,
// "Redaction"): whether to take one at all (never while a password field has focus, never for a secret value), and
// where the password and card fields are, to black out in the picture. Boxes are in the picture's pixels (the
// viewport times devicePixelRatio, which is what chrome.tabs.captureVisibleTab returns), and only for the top frame,
// whose viewport the picture is.
export interface ShotHint {
  skip?: boolean;
  masks?: { x: number; y: number; w: number; h: number }[];
}

const SENSITIVE = 'input[type="password"], [autocomplete^="cc-"], [data-shadow-private]';

export function shotHint(doc: Document, event: { secret?: boolean }): ShotHint {
  const win = doc.defaultView;
  if (event.secret) return { skip: true };
  const active = doc.activeElement;
  if (active instanceof HTMLInputElement && active.type === "password") return { skip: true };
  if (!win || win !== win.top) return {};
  const scale = win.devicePixelRatio || 1;
  const masks: NonNullable<ShotHint["masks"]> = [];
  for (const el of doc.querySelectorAll(SENSITIVE)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > win.innerHeight || r.left > win.innerWidth) continue;
    masks.push({
      x: Math.round(r.left * scale),
      y: Math.round(r.top * scale),
      w: Math.round(r.width * scale),
      h: Math.round(r.height * scale),
    });
    if (masks.length >= 50) break;
  }
  return masks.length > 0 ? { masks } : {};
}
