// Page-side capture: turns your clicks, typing and choices into trace events, each with its element described by
// meaning. Listeners run in the capture phase, so a page that stops propagation can't hide an event from us.
// Only `import type` from @shadow/core here: a runtime import would bundle zod into every frame of every page.
import type { ElementDescriptor, TraceEvent } from "@shadow/core";
import { rowsOf, sheetExportUrl } from "@shadow/player/csv";
import { actionableTarget, describeElement, hasVerifiedSelector, listPosition } from "./describe.ts";
import { watchEffects } from "./effect.ts";

export type PageEvent = Pick<
  TraceEvent,
  | "event"
  | "value"
  | "secret"
  | "checked"
  | "file"
  | "files"
  | "accept"
  | "echo"
  | "native"
  | "drawn"
  | "pasted"
  | "context"
  | "list"
  | "point"
  | "via"
  | "cid"
  | "newTab"
  | "cell"
  | "modifiers"
  | "of"
  | "effect"
> & {
  at?: number; // set when the event is sent later than it happened (a copy waits for the sheet's context)
  target?: ElementDescriptor;
  to?: ElementDescriptor;
};

const TEXT_INPUTS = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);
// Enter or Space on these fires a click event, which is recorded instead of the key.
const CLICKABLE = "button, a[href], summary, [role=button], [role=link], input[type=submit], input[type=button]";

// Fields whose values are never recorded. They become secret inputs, filled from the Keychain at run time.
export function isSecret(el: Element): boolean {
  if (el.localName !== "input") return false;
  const input = el as HTMLInputElement;
  return (
    input.type === "password" ||
    /current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp/.test(input.autocomplete) ||
    /pass|otp|cvv|cvc|secret|token|^pin$/i.test(input.name)
  );
}

export interface CaptureOptions {
  // Reads a Google Sheet's CSV export (the extension's background worker does it, with your cookies).
  fetchSheet?(url: string): Promise<string>;
}

// Shadow's own UI in the page (the floating Record / Stop button) carries this attribute. Nothing done to it is
// recorded: pressing Stop is not a step of your task. Its shadow root is closed, so events from inside it reach these
// listeners retargeted to that element.
export const OWN_UI = "data-shadow-ui";
const isOwnUi = (node: EventTarget) => node instanceof Element && node.hasAttribute(OWN_UI);

const COPY_LIMIT = 2_000; // characters of copied text kept in the trace
const DRAWN_AREA = 200 * 200; // a click target this big with no role, name or text is a drawing surface

// Starts listening on one document (one page or frame) and returns a function that stops it.
export function startCapture(
  doc: Document,
  emit: (event: PageEvent) => void,
  isRecording: () => boolean,
  options: CaptureOptions = {},
): () => void {
  // Described at pointerdown, sent at click: by click time the page may have re-rendered or removed the element.
  let pending: { hit: EventTarget | undefined; el: Element; target: ElementDescriptor } | undefined;
  let lastClick: { el: Element; at: number } | undefined;
  let lastEnter: { form: Element | null; at: number } | undefined;
  // Drags. A pointer drag is a press on one element and a release elsewhere (most kanban boards); an HTML5 drag
  // starts with dragstart on a draggable element and ends with drop.
  let pressed: { el: Element; x: number; y: number } | undefined;
  let nativeDrag: { el: Element; target: ElementDescriptor } | undefined;
  let suppressClickUntil = -1;
  const dirty = new WeakSet<Element>(); // text fields typed into since their value was last sent
  const pasted = new WeakSet<Element>(); // fields whose value came from a paste: the value stays out of the trace
  const sent = new WeakMap<Element, string>(); // the value last sent per field

  const send = (event: PageEvent["event"], el: Element, extra: Partial<PageEvent> = {}, target = describeElement(el)) =>
    emit({ event, target, echo: hasVerifiedSelector(target), ...extra });
  let lastCopyKey = Number.NEGATIVE_INFINITY; // when ⌘C / Ctrl+C was last pressed: a copy right after it was by keyboard
  const listOf = (el: Element): Partial<PageEvent> => {
    const list = listPosition(el);
    return list ? { list } : {};
  };
  // Where a click landed, as evidence for the picture taken after it (top frame only: the picture is its viewport).
  const pointOf = (e: MouseEvent, el: Element): Partial<PageEvent> => {
    const win = doc.defaultView;
    if (!win || win !== win.top) return {};
    const r = el.getBoundingClientRect();
    return {
      point: {
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        dpr: win.devicePixelRatio || 1,
        box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      },
    };
  };
  // Selecting text, to copy it or to read it, is the event; never what was selected in a password field.
  const sendSelection = () => {
    const selected = selectionOf(doc);
    if (!selected || isSecret(selected.el)) return;
    send("select_text", selected.el, { value: selected.text, ...listOf(selected.el) });
  };

  // Many keystrokes become one "type" event with the field's final value.
  const flushTyping = (el: Element) => {
    if (!dirty.has(el)) return;
    dirty.delete(el);
    const value = fieldValue(el);
    if (sent.get(el) === value) return;
    sent.set(el, value);
    if (isSecret(el)) send("type", el, { secret: true });
    else if (pasted.has(el)) {
      pasted.delete(el);
      send("type", el, { pasted: true }); // filled from what was copied ({{vars.x}}), never stored
    } else send("type", el, { value });
  };

  // What each click and Enter did (effect.ts): observed only while a recording is open.
  const effects = watchEffects(doc);
  // Sent as its own event 700 ms later: a click that navigates away is gone by then, and its effect is the navigation
  // the browser reports.
  const watchAfter = (el: Element, cid: string) =>
    effects.watch(el, (effect) => {
      if (isRecording()) emit({ event: "effect", of: cid, effect });
    });

  const listeners: [string, (event: Event) => void][] = [
    [
      "pointerdown",
      (e) => {
        const el = actionableTarget(e);
        pending = el ? { hit: e.composedPath()[0], el, target: describeElement(el) } : undefined;
        const m = e as MouseEvent;
        pressed = el ? { el, x: m.clientX, y: m.clientY } : undefined;
      },
    ],
    [
      "pointerup",
      (e) => {
        const start = pressed;
        pressed = undefined;
        if (!start) return;
        const m = e as MouseEvent;
        if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < 10) return; // a click
        if (doc.getSelection()?.toString().trim()) {
          // Selecting text: the selection is the event, not a drag, and not the click the browser fires next on
          // whatever holds both ends of it. That click became a step replay could never find (section-study §R1).
          suppressClickUntil = e.timeStamp + 100;
          sendSelection();
          return;
        }
        const from = start.el;
        if (editableField(from) || from.localName === "canvas" || (from as HTMLInputElement).type === "range") return;
        // What is under the pointer, skipping the dragged element (libraries often move it along with the pointer).
        const below = (doc.elementsFromPoint?.(m.clientX, m.clientY) ?? []).find(
          (el) => el !== from && !from.contains(el) && !el.contains(from) && !isOwnUi(el),
        );
        if (!below) return;
        suppressClickUntil = e.timeStamp + 100; // the browser still fires a click on the common ancestor
        const source = pending?.el === from ? pending.target : describeElement(from);
        send("drag", from, { to: describeElement(zoneOf(below)), native: false }, source);
      },
    ],
    [
      "dragstart",
      (e) => {
        pressed = undefined; // the browser took over: an HTML5 drag, not a pointer one
        const hit = e.composedPath()[0];
        const el = hit instanceof Element ? (hit.closest('[draggable="true"]') ?? hit) : undefined;
        nativeDrag = el ? { el, target: describeElement(el) } : undefined;
      },
    ],
    [
      "dragend",
      () => {
        nativeDrag = undefined;
      },
    ],
    [
      "click",
      (e) => {
        const fresh = pending && e.composedPath().includes(pending.hit as EventTarget) ? pending : undefined;
        pending = undefined;
        // Keyboard "clicks" (Enter or Space on a button) have no pointerdown, so describe now.
        const el = fresh?.el ?? actionableTarget(e);
        if (!el || e.timeStamp <= suppressClickUntil) return;
        // A double or triple click selects a word or a line: that selection is the event.
        if ((e as MouseEvent).detail >= 2 && doc.getSelection()?.toString().trim()) {
          sendSelection();
          return;
        }
        // Enter in a form field makes the browser click the form's submit button (implicit submission, measured in
        // Chrome on fixtures/pages/timesheet.html). The Enter is the step; replaying both would submit twice.
        const implicit = lastEnter && e.timeStamp - lastEnter.at < 100 && el.closest("form") === lastEnter.form;
        if (!fresh && (e as MouseEvent).detail === 0 && implicit) return;
        // Clicking a <label> makes the browser click its control as well: one action, recorded once.
        if (lastClick && lastClick.el === el && e.timeStamp - lastClick.at < 100) return;
        lastClick = { el, at: e.timeStamp };
        const target = fresh?.target ?? describeElement(el);
        // A click with no element to remember (a canvas, or a big area with no role, name or text): drawn apps such as
        // Google Sheets. It can't be replayed by element; it is context for the copy or keys that follow.
        const box = el.getBoundingClientRect();
        const drawn =
          el.localName === "canvas" ||
          (!target.role && !target.name && !target.text && box.width * box.height >= DRAWN_AREA);
        const cid = newId();
        const extras = { ...(drawn ? { drawn: true } : {}), cid, ...pointOf(e as MouseEvent, el), ...listOf(el) };
        send("click", el, extras, target);
        watchAfter(el, cid);
      },
    ],
    [
      "input",
      (e) => {
        const el = editableField(e.composedPath()[0]);
        if (el) dirty.add(el);
      },
    ],
    [
      "change",
      (e) => {
        const el = e.composedPath()[0];
        if (!(el instanceof Element)) return;
        if (el.localName === "select") {
          const select = el as HTMLSelectElement;
          const option = select.selectedOptions[0];
          // The visible label: what you saw, and what the player selects by (executor.ts, web.select { option }).
          send("select", el, { value: option ? option.label.trim() || option.value : select.value });
          return;
        }
        if (el.localName === "input") {
          const input = el as HTMLInputElement;
          if (input.type === "checkbox" || input.type === "radio") {
            send("check", el, { checked: input.checked });
            return;
          }
          if (input.type === "file") {
            // The page only ever gets the file's name, never its path. The compiler turns it into a file input,
            // checked at run time against the kinds of file this input takes (its accept attribute).
            const file = input.files?.[0];
            const accept = input.accept.trim() || undefined;
            if (file)
              send("file", el, { file: fileInfo(file), files: Array.from(input.files ?? []).map(fileInfo), accept });
            return;
          }
        }
        if (editableField(el)) {
          dirty.add(el);
          flushTyping(el);
          return;
        }
        send("type", el, { value: fieldValue(el) }); // range, color and other value inputs
      },
    ],
    [
      // Contenteditable fields have no change event; their value is final when focus leaves.
      "focusout",
      (e) => {
        const el = editableField(e.composedPath()[0]);
        if (el) flushTyping(el);
      },
    ],
    [
      "keydown",
      (e) => {
        const key = (e as KeyboardEvent).key;
        if (((e as KeyboardEvent).metaKey || (e as KeyboardEvent).ctrlKey) && key.toLowerCase() === "c") {
          lastCopyKey = Date.now();
        }
        if (key !== "Enter" && key !== "Escape" && key !== "Tab") return;
        const hit = e.composedPath()[0];
        const el = hit instanceof Element ? hit : doc.activeElement;
        const field = editableField(hit);
        // The value must reach the trace before the key that submits it.
        if (field) flushTyping(field);
        // Tab only moves focus: the next step targets its own field. Enter in a textarea is a newline.
        if (!el || key === "Tab" || el.closest(CLICKABLE)) return;
        if (key === "Enter" && el.localName === "textarea") return;
        if (key === "Enter") lastEnter = { form: el.closest("form"), at: e.timeStamp };
        const cid = newId();
        send("key", el, { value: key, cid });
        if (key === "Enter") watchAfter(field ?? el, cid);
      },
    ],
    [
      "paste",
      (e) => {
        const field = editableField(e.composedPath()[0]) ?? (doc.activeElement && editableField(doc.activeElement));
        if (!field) return;
        pasted.add(field);
        dirty.add(field);
        send("paste", field, { pasted: true });
      },
    ],
    [
      "submit",
      (e) => {
        const form = e.composedPath()[0];
        if (form instanceof Element) send("submit", form);
      },
    ],
    [
      // Files dragged in from Finder. The page gets their names, sizes and dates, never their paths: the daemon
      // finds each file on disk afterwards. Replay hands the file to the page directly (an upload step).
      "drop",
      (e) => {
        const files = Array.from((e as DragEvent).dataTransfer?.files ?? []);
        if (files.length === 0) {
          // An element dragged within the page: where it landed.
          const to = nativeDrag && dropZone(e);
          if (nativeDrag && to)
            send("drag", nativeDrag.el, { to: describeElement(to), native: true }, nativeDrag.target);
          nativeDrag = undefined;
          return;
        }
        const el = dropZone(e);
        if (el) send("drop", el, { file: files[0] && fileInfo(files[0]), files: files.map(fileInfo) });
      },
    ],
  ];
  // change and submit are not "composed": inside a shadow root (YouTube Studio is built of them) they never reach
  // the document. So every shadow root you interact with gets those two listeners as well.
  const SHADOW_ONLY = new Set(["change", "submit"]);
  const watchedRoots = new WeakSet<ShadowRoot>();
  const stops: (() => void)[] = [];

  const listen = (root: Document | ShadowRoot, only?: Set<string>) => {
    for (const [type, handler] of listeners) {
      if (only && !only.has(type)) continue;
      const wrapped = (event: Event) => {
        if (!isRecording()) {
          effects.pause(); // the recording ended: stop watching this page
          return;
        }
        effects.start(); // a recording is open: watch the page's changes (from its first event here)
        try {
          if (event.composedPath().some(isOwnUi)) return;
          for (const node of event.composedPath()) {
            if (node instanceof ShadowRoot && !watchedRoots.has(node)) {
              watchedRoots.add(node);
              listen(node, SHADOW_ONLY);
            }
          }
          handler(event);
        } catch (error) {
          console.warn("[shadow] capture failed", error);
        }
      };
      root.addEventListener(type, wrapped, true);
      stops.push(() => root.removeEventListener(type, wrapped, true));
    }
  };

  listen(doc);
  stops.push(() => effects.stop());

  // copy is read last (bubble phase on the window), after the page's own handler: apps that draw their content
  // (Google Sheets) put the copied value on the clipboard themselves.
  const onCopy = (event: Event) => {
    if (!isRecording() || event.composedPath().some(isOwnUi)) return;
    const at = Date.now();
    const text = (
      (event as ClipboardEvent).clipboardData?.getData("text/plain") ||
      doc.getSelection()?.toString() ||
      ""
    )
      .trim()
      .slice(0, COPY_LIMIT);
    if (!text) return;
    const selected = selectionOf(doc);
    const el = selected?.el ?? doc.activeElement ?? doc.body;
    const via: PageEvent["via"] = Date.now() - lastCopyKey < 1_000 ? "keyboard" : "menu";
    lastCopyKey = Number.NEGATIVE_INFINITY; // one ⌘C, one copy
    // Copied out of a password or one-time-code field: recorded that it happened, never what was copied.
    if (isSecret(el)) {
      send("copy", el, { at, secret: true });
      return;
    }
    const sheet = sheetExportUrl(doc.location?.href ?? "");
    if (!sheet || !options.fetchSheet) {
      send("copy", el, { at, value: text, via, ...listOf(el) });
      return;
    }
    // Context for the compiler: the sheet's header and the row the copied cell is in, so it can write a rule such as
    // "Amount of the row whose Date is today" instead of a fixed cell.
    options
      .fetchSheet(sheet)
      .then((csv) => {
        const rows = rowsOf(csv);
        const index = rows.findIndex((row) => Object.values(row).includes(text));
        const row = rows[index];
        const column = row && Object.keys(row).find((k) => row[k] === text);
        send("copy", el, {
          at,
          value: text,
          via,
          drawn: true,
          context: { sheet, header: Object.keys(rows[0] ?? {}), row, column, rowIndex: index, rows: rows.length },
        });
      })
      .catch(() => send("copy", el, { at, value: text, via, drawn: true, context: { sheet } }));
  };
  const win = doc.defaultView;
  win?.addEventListener("copy", onCopy);
  stops.push(() => win?.removeEventListener("copy", onCopy));

  return () => {
    for (const stop of stops) stop();
  };
}

// The selected text and the smallest element holding all of it: the heading you copied a company name from, not the
// card around it, nor whatever element the selection happened to start in.
function selectionOf(doc: Document): { text: string; el: Element } | undefined {
  const sel = doc.getSelection();
  const text = sel?.toString().trim().slice(0, COPY_LIMIT);
  if (!sel || !text || sel.rangeCount === 0) return undefined;
  const common = sel.getRangeAt(0).commonAncestorContainer;
  const el = common.nodeType === 1 ? (common as Element) : common.parentElement;
  return el && el !== doc.body && el !== doc.documentElement ? { text, el } : undefined;
}

const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const fileInfo = (f: File) => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified });

// Where a dragged element landed, as replay will look for it: the nearest list, column or labelled area around the
// element under the pointer.
function zoneOf(el: Element): Element {
  for (let a: Element | null = el; a && a.localName !== "body" && a.localName !== "html"; a = a.parentElement) {
    if (
      a.id ||
      a.getAttribute("aria-label") ||
      a.getAttribute("role") ||
      /drop|list|column|lane/i.test(a.getAttribute("class") ?? "")
    ) {
      return a;
    }
  }
  return el;
}

// The element a file was dropped onto, as replay will look for it: the nearest one with something to recognise it
// by (an id, a label, a role, or "drop" in its class), else the element under the pointer.
function dropZone(e: Event): Element | undefined {
  const path = e.composedPath().filter((n): n is Element => n instanceof Element && n.localName !== "body");
  return (
    path.find(
      (el) =>
        el.localName !== "html" &&
        (el.id ||
          el.getAttribute("aria-label") ||
          el.getAttribute("role") ||
          /drop/i.test(el.getAttribute("class") ?? "")),
    ) ?? path[0]
  );
}

function editableField(node: EventTarget | null | undefined): Element | undefined {
  if (!(node instanceof Element)) return undefined;
  if (node.localName === "textarea") return node;
  if (node.localName === "input") return TEXT_INPUTS.has((node as HTMLInputElement).type) ? node : undefined;
  return node.closest("[contenteditable]:not([contenteditable=false])") ?? undefined;
}

function fieldValue(el: Element): string {
  return "value" in el ? String((el as HTMLInputElement).value) : (el.textContent ?? "");
}
