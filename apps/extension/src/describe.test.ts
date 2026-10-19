// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { describeElement, listPosition } from "./describe.ts";

const $ = (s: string) => document.querySelector(s) as HTMLElement;

describe("describeElement", () => {
  it("drops Google's per-session ids and keeps stable ones", () => {
    document.body.innerHTML = `<div id=":1g" role="tab" aria-label="KPI Sheet">KPI Sheet</div>
      <div id="19fml5:17" role="tab">Other</div><button id="save" name="save">Save</button>`;
    expect(describeElement($("[role=tab]")).attrs).toEqual({ "aria-label": "KPI Sheet" });
    expect(describeElement($("[id='19fml5:17']")).attrs).toBeUndefined();
    expect(describeElement($("#save")).attrs).toEqual({ id: "save", name: "save" });
  });

  it("keeps a link's address even with ids in it, and names a nameless card link from its card", () => {
    document.body.innerHTML = `<ul class="jobs">
      <li class="job"><a href="/companies/eventual/jobs/7421"><img src="logo.png"></a><h3>Eventual</h3></li>
      <li class="job"><a href="/companies/numeral/jobs/7422"><img src="logo.png"></a><h3>Numeral</h3></li>
      <li class="job"><a href="/companies/arc/jobs/7423"><img src="logo.png"></a><h3>Arc</h3></li></ul>`;
    const d = describeElement($("a"));
    expect(d.name).toBeUndefined();
    expect(d).toMatchObject({
      seenAs: "Eventual",
      seenFrom: "card",
      href: "/companies/eventual/jobs/7421",
      hrefShape: "/companies/eventual/jobs/*",
    });
    expect(d.attrs?.href).toBeUndefined(); // never matched on: a job id differs next time
  });
});

describe("listPosition", () => {
  it("finds the item a click is in, its place and the list", () => {
    document.body.innerHTML = `<ul class="jobs">${["Eventual", "Numeral", "Arc"]
      .map((n) => `<li class="job active-${n === "Numeral"}"><a href="/x"><span>${n}</span></a><p>Remote</p></li>`)
      .join("")}</ul>`;
    const second = document.querySelectorAll("span")[1] as Element;
    expect(listPosition(second)).toMatchObject({ index: 1, count: 3, itemText: "Numeral Remote" });
    document.body.innerHTML = "<p><span>a</span> <span>b</span></p>";
    expect(listPosition($("span"))).toBeUndefined(); // two loose spans are not a list
  });
});
