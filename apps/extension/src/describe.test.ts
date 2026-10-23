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

  it("names only controls: a paragraph, a page area and the page itself keep their own text (Wikipedia, GitHub)", () => {
    document.body.innerHTML = `<main><section><p id="intro">Gross domestic product is the market value of goods</p>
      <h2>Table</h2></section><div id="area"><img alt="mrleemurray" src="a.png"><p>Evolving the VS Code Interface</p></div>
      <h1>Contents</h1></main>`;
    expect(describeElement($("#intro")).seenAs).toBeUndefined();
    expect(describeElement($("#area")).seenAs).toBeUndefined();
    expect(describeElement(document.body).seenAs).toBeUndefined();
    expect(describeElement($("#intro")).text).toBe("Gross domestic product is the market value of goods");
  });

  it("stars every word with a digit in a link's shape: a job id is one id, not digits inside letters (YC)", () => {
    document.body.innerHTML = `<a href="/companies/y-combinator/jobs/fK75gxxbq-product-engineer-post-batch">Job</a>`;
    expect(describeElement($("a")).hrefShape).toBe("/companies/y-combinator/jobs/*-product-engineer-post-batch");
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

  it("puts a link in a table cell at its row, not at its column (Wikipedia's table, Gmail's grid)", () => {
    const rows = ["Japan", "India", "France"]
      .map((n) => `<tr><td><a href="/wiki/${n}">${n}</a></td><td>1</td><td>2</td><td>3</td></tr>`)
      .join("");
    document.body.innerHTML = `<table><tbody>${rows}</tbody></table>`;
    const india = document.querySelectorAll("a")[1] as Element;
    expect(listPosition(india)).toMatchObject({ index: 1, count: 3, itemText: "India 1 2 3" });
    const cells = (n: string) =>
      `<div role="row"><div role="gridcell"><span>${n}</span></div><div role="gridcell">a</div><div role="gridcell">b</div></div>`;
    document.body.innerHTML = `<div role="grid">${["Mail A", "Mail B", "Mail C"].map(cells).join("")}</div>`;
    expect(listPosition(document.querySelectorAll("span")[2] as Element)).toMatchObject({ index: 2, count: 3 });
  });

  it("counts every row of Gmail's list, read or unread, and the one under the pointer (it gets a hover class)", () => {
    const row = (n: number, cls: string) =>
      `<tr role="row" class="${cls}"><td role="gridcell"><div role="link" id="m${n}">Mail ${n}</div></td></tr>`;
    document.body.innerHTML = `<table role="grid"><tbody>${row(0, "zA zE s00Hgd aqw")}${row(1, "zA yO s00Hgd")}${row(2, "zA zE s00Hgd")}${row(3, "zA yO s00Hgd")}</tbody></table>`;
    expect(listPosition($("#m0"))).toMatchObject({ index: 0, count: 4, itemText: "Mail 0" });
    expect(listPosition($("#m3"))).toMatchObject({ index: 3, count: 4 });
  });

  it("never makes a list of paragraphs or page sections (an article's text is not a list)", () => {
    document.body.innerHTML = `<main><section><p id="a">Gross domestic product <a href="/x">GDP</a></p><p>Two</p>
      <p>Three</p></section><section><p>Four</p></section><section><p>Five</p></section></main>`;
    expect(listPosition($("#a"))).toBeUndefined();
    expect(listPosition($("#a a"))).toBeUndefined();
  });
});

describe("a structural selector that is really this element's", () => {
  // Checkpoint 4 (A): Hacker News nests its stories' table inside its layout table; six levels up, the first story's
  // title path also matched a span in the header, so the copy was saved with no selector at all.
  it("climbs past six levels while the path still matches something else", () => {
    const row = (cells: string) => `<tr>${cells}</tr>`;
    const nested = (inner: string) =>
      `<table><tbody><tr><td><table><tbody>${inner}</tbody></table></td></tr></tbody></table>`;
    document.body.innerHTML = `<center>${nested(row("<td></td><td></td><td><span>new | past</span></td>"))}${nested(
      row("<td>1.</td><td></td><td><span>Local Wikipedia</span></td>"),
    )}</center>`;
    const title = document.querySelectorAll("span")[1] as Element;
    const css = describeElement(title).selectors.css;
    expect(css).toBeDefined();
    expect(document.querySelectorAll(css as string)).toHaveLength(1);
  });
});
