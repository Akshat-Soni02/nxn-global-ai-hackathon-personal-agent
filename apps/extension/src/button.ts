// The floating Record / Stop button. The content script draws it in the top frame of each page while the daemon is
// running. It is only a remote control: a press asks the daemon (through background.ts) to start or stop, and what it
// shows is what the daemon reported back (record.start, record.stop, record.status).
// - A closed shadow root and a constructed stylesheet: page CSS can't reach it, and a page's CSP doesn't apply.
// - No innerHTML: pages such as Google Sheets enforce Trusted Types. The icons are SVG built node by node.
// - Marked OWN_UI, so capture.ts never records a press of it as a step of your task.
import { OWN_UI } from "./capture.ts";

export interface ButtonState {
  daemon: boolean; // the daemon is connected; without it the button is hidden
  desktop?: boolean; // Task Player.app's floating button is on screen: this one steps aside (one Record button)
  recording?: { since: number };
  // The last word from the daemon after stop: compiling, a question waiting in the terminal, saved, ...
  status?: {
    phase: "compiling" | "question" | "saved" | "empty" | "failed" | "busy" | "replay";
    text: string;
    at: number;
  };
}
export interface Position {
  right: number;
  bottom: number;
}
export interface ButtonOptions {
  // Resolves with an error to show (no daemon, extension reloaded), or undefined once the daemon has the command.
  press(command: "start" | "stop"): Promise<string | undefined>;
  loadPosition?(): Promise<Position | undefined>;
  savePosition?(position: Position): void;
  // False once this copy is orphaned (the extension was reloaded): it then stops putting its button back.
  alive?(): boolean;
}
export interface Button {
  update(state: ButtonState | undefined): void;
  remove(): void;
}

const HOST = "taskplayer-button"; // a custom tag: generic page selectors (div, span) miss it
const NOTE_MS = 15_000; // how long "Saved ..." stays before the button is Record again
const ERROR_MS = 6_000;
const SVG = "http://www.w3.org/2000/svg";
type Shape = [tag: string, attrs: Record<string, string | number>];
const line = { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
const ICONS = {
  record: [["circle", { cx: 8, cy: 8, r: 5.5, fill: "#ef4444" }]],
  stop: [["rect", { x: 3.5, y: 3.5, width: 9, height: 9, rx: 2, fill: "#fff" }]],
  spinner: [
    ["circle", { cx: 8, cy: 8, r: 6, fill: "none", stroke: "rgba(255,255,255,.3)", "stroke-width": 2 }],
    ["path", { ...line, d: "M8 2a6 6 0 0 1 6 6", stroke: "#fff", "stroke-width": 2 }],
  ],
  terminal: [
    ["rect", { ...line, x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "#fbbf24", "stroke-width": 1.5 }],
    ["path", { ...line, d: "M4.5 6l2 2-2 2M8.5 10.5h3", stroke: "#fbbf24", "stroke-width": 1.5 }],
  ],
  check: [["path", { ...line, d: "M3 8.5l3.2 3.2L13 4.8", stroke: "#4ade80", "stroke-width": 2 }]],
  alert: [
    ["circle", { ...line, cx: 8, cy: 8, r: 6.25, stroke: "#fbbf24", "stroke-width": 1.5 }],
    ["path", { ...line, d: "M8 4.8v3.8", stroke: "#fbbf24", "stroke-width": 1.6 }],
    ["circle", { cx: 8, cy: 11.2, r: 0.9, fill: "#fbbf24" }],
  ],
} satisfies Record<string, Shape[]>;

interface View {
  kind: "idle" | "rec" | "work" | "note";
  icon: keyof typeof ICONS;
  text: string;
  label: string; // what a screen reader says, and the tooltip
}

const CSS = `
.btn {
  all: initial; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  height: 40px; min-width: 40px; padding: 0 14px 0 12px; border-radius: 20px;
  background: #18181b; color: #fafafa; font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 6px 18px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.14);
  cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: none;
  transition: background-color .15s ease, transform .15s ease;
}
.btn:hover { transform: translateY(-1px); }
.btn:active { transform: scale(.97); }
.btn:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
.btn.idle { width: 40px; padding: 0; justify-content: center; }
.btn.idle .text { display: none; }
.btn.idle:hover, .btn.idle:focus-visible { width: auto; padding: 0 14px 0 12px; }
.btn.idle:hover .text, .btn.idle:focus-visible .text { display: inline; }
.btn.rec { background: #dc2626; }
.btn.work { cursor: default; }
.btn.dragging { cursor: grabbing; transition: none; }
svg { width: 16px; height: 16px; flex: none; display: block; }
.rec svg { animation: pulse 1.4s ease-in-out infinite; }
.work .spinner { animation: spin .9s linear infinite; }
.text { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
@keyframes pulse { 50% { opacity: .45; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .rec svg, .work .spinner { animation: none; } }
`;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function viewOf(
  state: ButtonState | undefined,
  now: number,
  local?: { text: string; at: number },
): View | undefined {
  if (!state?.daemon || state.desktop) return undefined;
  if (local && now - local.at < ERROR_MS) return { kind: "note", icon: "alert", text: local.text, label: local.text };
  if (state.recording) {
    const time = clock(now - state.recording.since);
    return { kind: "rec", icon: "stop", text: `Stop · ${time}`, label: `Stop recording (${time})` };
  }
  const s = state.status;
  if (s?.phase === "compiling" || s?.phase === "replay") {
    return { kind: "work", icon: "spinner", text: s.text, label: s.text };
  }
  if (s?.phase === "question") return { kind: "work", icon: "terminal", text: s.text, label: s.text };
  if (s && now - s.at < NOTE_MS) {
    return { kind: "note", icon: s.phase === "saved" ? "check" : "alert", text: s.text, label: s.text };
  }
  return { kind: "idle", icon: "record", text: "Record", label: "Record a task (Task Player)" };
}

export function mountButton(doc: Document, options: ButtonOptions): Button {
  // A button left by an orphaned copy of the content script shows stale state: this copy replaces it.
  for (const old of doc.querySelectorAll(HOST)) old.remove();
  const host = doc.createElement(HOST);
  host.setAttribute(OWN_UI, "");
  const css = (name: string, value: string) => host.style.setProperty(name, value, "important");
  css("all", "initial");
  css("position", "fixed");
  css("z-index", "2147483647");
  css("display", "none");
  const root = host.attachShadow({ mode: "closed" });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = doc.createElement("style"); // no constructed stylesheets (jsdom)
    style.textContent = CSS;
    root.append(style);
  }
  const btn = doc.createElement("button");
  btn.type = "button";
  root.append(btn);

  let state: ButtonState | undefined;
  let local: { text: string; at: number } | undefined;
  let dismissed = 0; // a note you clicked away
  let shown = "";
  let position: Position = { right: 20, bottom: 20 };
  let timer: ReturnType<typeof setInterval> | undefined;

  const place = () => {
    css("right", `${position.right}px`);
    css("bottom", `${position.bottom}px`);
  };
  place();
  void options.loadPosition?.().then((saved) => {
    if (saved) position = saved;
    place();
  });

  const icon = (name: keyof typeof ICONS) => {
    const svg = doc.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", name);
    for (const [tag, attrs] of ICONS[name] as Shape[]) {
      const shape = doc.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, String(v));
      svg.append(shape);
    }
    return svg;
  };

  const current = () => {
    const status = state?.status && state.status.at <= dismissed ? { ...state, status: undefined } : state;
    return viewOf(status, Date.now(), local);
  };

  const render = () => {
    const view = current();
    css("display", view ? "block" : "none");
    // A clock while recording, and to let a note expire.
    const ticking = view && (view.kind === "rec" || view.kind === "note");
    if (ticking && !timer) timer = setInterval(render, 1000);
    if (!ticking && timer) {
      clearInterval(timer);
      timer = undefined;
    }
    if (!view) return;
    const key = JSON.stringify(view);
    if (key === shown) return;
    shown = key;
    btn.className = `btn ${view.kind}`;
    btn.setAttribute("aria-label", view.label);
    btn.title = view.label;
    const text = doc.createElement("span");
    text.className = "text";
    text.textContent = view.text;
    btn.replaceChildren(icon(view.icon), text);
  };

  const press = async () => {
    const view = current();
    if (!view || view.kind === "work") return; // compiling, or a question is open in the terminal
    if (view.kind === "note") {
      local = undefined;
      dismissed = Date.now();
      return render();
    }
    const error = await options.press(view.kind === "rec" ? "stop" : "start");
    if (error) local = { text: error, at: Date.now() };
    render();
  };

  // Drag to move it out of the way; a press that moved is not a click.
  let drag: { x: number; y: number; from: Position; moved: boolean } | undefined;
  let swallowClick = false;
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, from: position, moved: false };
    btn.setPointerCapture?.(e.pointerId);
  });
  btn.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    btn.classList.add("dragging");
    const view = doc.defaultView;
    const maxRight = (view?.innerWidth ?? 800) - btn.offsetWidth - 4;
    const maxBottom = (view?.innerHeight ?? 600) - btn.offsetHeight - 4;
    position = {
      right: Math.round(Math.min(Math.max(4, drag.from.right - dx), maxRight)),
      bottom: Math.round(Math.min(Math.max(4, drag.from.bottom - dy), maxBottom)),
    };
    place();
  });
  const endDrag = () => {
    if (drag?.moved) {
      swallowClick = true;
      btn.classList.remove("dragging");
      options.savePosition?.(position);
    }
    drag = undefined;
  };
  btn.addEventListener("pointerup", endDrag);
  btn.addEventListener("pointercancel", endDrag);
  btn.addEventListener("click", () => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    void press();
  });

  const button: Button = {
    update(next) {
      state = next;
      render();
    },
    remove() {
      observer.disconnect();
      if (timer) clearInterval(timer);
      doc.removeEventListener("DOMContentLoaded", mount);
      host.remove();
    },
  };

  // In the document element, not the body: pages that replace their body keep the button. Put back if removed.
  const attach = () => {
    if (options.alive && !options.alive()) return button.remove();
    if (!host.isConnected) doc.documentElement?.append(host);
  };
  const observer = new MutationObserver(attach);
  const mount = () => {
    attach();
    if (doc.documentElement) observer.observe(doc.documentElement, { childList: true });
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();

  return button;
}
