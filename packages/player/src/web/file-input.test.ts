import { describe, expect, it } from "vitest";
import { type DomNode, fileAccessError, pickFileInput } from "./file-input.ts";

let next = 1;
const node = (localName: string, attrs: Record<string, string> = {}, children: DomNode[] = [], shadow?: DomNode[]) => ({
  backendNodeId: next++,
  nodeName: localName.toUpperCase(),
  localName,
  attributes: Object.entries(attrs).flat(),
  children,
  shadowRoots: shadow,
});

describe("pickFileInput", () => {
  it("finds the hidden input in the button's dialog, even inside a shadow root", () => {
    const button = node("button");
    const input = node("input", { type: "file", hidden: "" });
    const other = node("input", { type: "file", name: "avatar" });
    const host = node(
      "x-uploader",
      {},
      [],
      [node("#document-fragment", {}, [node("div", { role: "dialog" }, [button, input])])],
    );
    const root = node("#document", {}, [node("html", {}, [node("body", {}, [host, other])])]);
    expect(pickFileInput(root, button.backendNodeId)).toBe(input.backendNodeId);
  });

  it("uses the only file input on the page, and refuses to guess between two", () => {
    const button = node("button");
    const input = node("input", { type: "file" });
    expect(pickFileInput(node("#document", {}, [button, input]), button.backendNodeId)).toBe(input.backendNodeId);
    const two = node("#document", {}, [button, node("input", { type: "file" }), node("input", { type: "file" })]);
    expect(pickFileInput(two, button.backendNodeId)).toBeUndefined();
    expect(pickFileInput(node("#document", {}, [button]), button.backendNodeId)).toBeUndefined();
  });

  it("names the Chrome setting when local file access is refused", () => {
    expect(fileAccessError(new Error('{"code":-32000,"message":"Not allowed"}'))).toMatch(/Allow access to file URLs/);
    expect(fileAccessError(new Error("node not found"))).toBe("node not found");
  });
});
