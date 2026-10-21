import type { ElementDescriptor } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { classOf } from "./classes.ts";

const PAGE = "https://mail.google.com/mail/u/0/#inbox";
const target = (role: string): ElementDescriptor => ({
  tag: "div",
  url: PAGE,
  role,
  name: "x",
  fallbacks: [],
  selectors: {},
});
const step = (kind: NormalisedStep["kind"], extra: Partial<NormalisedStep> = {}): NormalisedStep => ({
  index: 0,
  kind,
  at: 0,
  url: PAGE,
  events: ["e1"],
  ...extra,
});

describe("what a step did", () => {
  it("goes somewhere: a page opened, a link followed, a tab opened", () => {
    expect(classOf(step("navigate"))).toBe("go");
    expect(classOf(step("click", { target: target("link"), navigatesTo: "https://x.test/a" }))).toBe("go");
    expect(classOf(step("click", { target: target("link"), opensTab: 2 }))).toBe("go");
    expect(classOf(step("click", { target: target("link"), effect: { changed: "large", navigated: true } }))).toBe(
      "go",
    );
    expect(classOf(step("click", { target: target("link") }))).toBe("go"); // an older recording: no effect kept
  });

  it("reveals something: a menu, an expanded section, an opened email that stays on the page", () => {
    expect(classOf(step("click", { target: target("button"), effect: { changed: "small", expanded: true } }))).toBe(
      "reveal",
    );
    expect(classOf(step("click", { target: target("gridcell"), effect: { changed: "large" } }))).toBe("reveal");
  });

  it("acts: types, presses, submits, and clicks a button that changed the page", () => {
    expect(classOf(step("type", { value: "20 Oct" }))).toBe("act");
    expect(classOf(step("press", { value: "Enter", sends: true }))).toBe("act");
    expect(classOf(step("click", { target: target("button"), effect: { changed: "small" } }))).toBe("act");
    expect(classOf(step("click", { target: target("button"), submits: true }))).toBe("act");
  });

  it("reads: a copy", () => {
    expect(classOf(step("copy", { value: "1,234" }))).toBe("read");
  });
});
