// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Effect, watchEffects } from "./effect.ts";

let clock = 0;
beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => vi.useRealTimers());

const settle = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

describe("what a click did", () => {
  it("is nothing for a click on a header while the inbox list keeps re-rendering (Gmail)", async () => {
    document.body.innerHTML = `<section id="list"><ul></ul></section><section id="mail"><header id="h">Print all In new window Daily KPIs</header></section>`;
    const watcher = watchEffects(document, () => clock);
    watcher.start(); // a recording is open
    const churn = async () => {
      for (let i = 0; i < 10; i++) {
        document.querySelector("#list ul")?.insertAdjacentHTML("beforeend", "<li>row</li>");
        await settle(60);
      }
    };
    await churn(); // the page's own churn before the click
    let effect: Effect | undefined;
    watcher.watch(document.querySelector("#h") as Element, (e) => {
      effect = e;
    });
    await churn(); // and after it, elsewhere
    await settle(100);
    watcher.stop();
    expect(effect).toEqual({ changed: "none" });
  });

  it("watches nothing until a recording starts, and forgets what it saw when it stops", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const watcher = watchEffects(document, () => clock);
    expect(observe).not.toHaveBeenCalled(); // your ordinary browsing is never watched
    watcher.start();
    expect(observe).toHaveBeenCalledTimes(1);
    watcher.pause();
    watcher.stop();
    observe.mockRestore();
  });

  it("says what opened, what expanded, and that a field was emptied by Enter (a message sent)", async () => {
    document.body.innerHTML = `<main><button id="menu" aria-expanded="false">More</button>
      <textarea id="chat">Date - 19 Oct</textarea></main>`;
    const watcher = watchEffects(document, () => clock);
    watcher.start();
    const seen: Effect[] = [];
    watcher.watch(document.querySelector("#menu") as Element, (e) => seen.push(e));
    (document.querySelector("#menu") as Element).setAttribute("aria-expanded", "true");
    document.body.insertAdjacentHTML("beforeend", `<div role="menu"><div role="menuitem">Export</div></div>`);
    await settle(700);
    const chat = document.querySelector("#chat") as HTMLTextAreaElement;
    watcher.watch(chat, (e) => seen.push(e));
    chat.value = "";
    await settle(700);
    watcher.stop();
    expect(seen[0]).toMatchObject({ expanded: true, opened: "menu" });
    expect(seen[1]).toMatchObject({ emptied: true });
  });
});
