// Finding the <input type=file> an upload step should fill, when the matched element is not the input itself.
// Upload dialogs (YouTube Studio's, for one) often keep a hidden file input elsewhere in the dialog, sometimes inside
// a shadow root, and open it from a "Select files" button with a script. Works on a pierced DOM.getDocument tree,
// which includes shadow roots that querySelector cannot see.

export interface DomNode {
  backendNodeId: number;
  nodeName: string;
  localName?: string;
  attributes?: string[]; // [name, value, name, value, ...]
  children?: DomNode[];
  shadowRoots?: DomNode[];
}

const attr = (node: DomNode, name: string): string | undefined => {
  const flat = node.attributes ?? [];
  for (let i = 0; i + 1 < flat.length; i += 2) if (flat[i] === name) return flat[i + 1];
  return undefined;
};
const isFileInput = (node: DomNode) => node.localName === "input" && attr(node, "type")?.toLowerCase() === "file";
const isDialog = (node: DomNode) =>
  node.localName === "dialog" ||
  ["dialog", "alertdialog"].includes(attr(node, "role") ?? "") ||
  attr(node, "aria-modal") === "true";
const kids = (node: DomNode) => [...(node.shadowRoots ?? []), ...(node.children ?? [])];

function pathTo(node: DomNode, backendNodeId: number): DomNode[] | undefined {
  if (node.backendNodeId === backendNodeId) return [node];
  for (const child of kids(node)) {
    const below = pathTo(child, backendNodeId);
    if (below) return [node, ...below];
  }
  return undefined;
}

function fileInputsUnder(node: DomNode): number[] {
  return [...(isFileInput(node) ? [node.backendNodeId] : []), ...kids(node).flatMap(fileInputsUnder)];
}

// The only file input in the matched element's nearest dialog, else the only file input on the page.
// Two or more candidates are ambiguous: better to fail than to upload into the wrong field.
export function pickFileInput(root: DomNode, matched: number): number | undefined {
  const path = pathTo(root, matched);
  if (!path) return undefined;
  const dialog = [...path].reverse().find(isDialog);
  const inDialog = dialog ? fileInputsUnder(dialog) : [];
  if (inDialog.length === 1) return inDialog[0];
  const all = fileInputsUnder(root);
  return all.length === 1 ? all[0] : undefined;
}

// Chrome refuses to hand local files to a page for an extension unless it has local file access
// ("Not allowed" from DOM.setFileInputFiles; content/browser/devtools/protocol/dom_handler.cc).
export function fileAccessError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /not allowed/i.test(message)
    ? 'Chrome would not give the file to the page. Open chrome://extensions, choose Details on Task Player and turn on "Allow access to file URLs", then run again.'
    : message;
}
