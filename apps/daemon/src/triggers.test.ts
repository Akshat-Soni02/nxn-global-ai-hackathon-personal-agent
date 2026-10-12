// Triggers with a fake clock and a fake service that records what fired; a real store and real files.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { writeState } from "./lifecycle.ts";
import { saveSkill } from "./skill-store.ts";
import { openStore, type RunRow } from "./store.ts";
import { startTriggers } from "./triggers.ts";

const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso).getTime(); // local time: no "Z", like the cron

function setup(when: unknown[], inputs: Record<string, unknown> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "shadow-triggers-"));
  saveSkill(
    dataDir,
    Skill.parse({
      id: "report",
      name: "Report",
      version: 1,
      description: { goal: "test" },
      steps: [
        { id: "start", type: "trigger", intent: "on its own", when, inputs },
        {
          id: "s1",
          type: "action",
          intent: "write",
          channel: "fs",
          action: "write",
          args: { path: "~/x", content: "x" },
        },
      ],
    }),
  );
  const store = openStore(join(dataDir, "shadow.db"));
  const fired: { trigger: string; provided?: Record<string, unknown> }[] = [];
  let busy: RunRow | undefined;
  const service = {
    fire: (_id: string, trigger: "schedule" | "folder", provided?: Record<string, unknown>) => {
      fired.push({ trigger, provided });
      return { status: "running" } as RunRow;
    },
    busy: () => busy,
  };
  let clock = 0;
  const triggers = (opts: { settleMs?: number } = {}) =>
    startTriggers({ dataDir, store, service, now: () => clock, watchDir: () => ({ close() {} }), ...opts });
  return {
    dataDir,
    fired,
    triggers,
    setClock: (t: number) => {
      clock = t;
    },
    live: (since: number) => writeState(dataDir, "report", { state: "live", since }),
    setBusy: (run: RunRow | undefined) => {
      busy = run;
    },
  };
}

describe("schedules", () => {
  it("fire once at their time, and not again after a restart", async () => {
    const t = setup([{ type: "schedule", cron: "0 9 * * *" }]);
    t.live(at("2026-10-12T08:00:00"));
    t.setClock(at("2026-10-12T08:30:00"));
    const first = t.triggers();
    await first.tick();
    expect(t.fired).toEqual([]);
    t.setClock(at("2026-10-12T09:00:20"));
    await first.tick();
    await first.tick();
    expect(t.fired).toEqual([{ trigger: "schedule", provided: undefined }]);
    // The daemon restarts a minute later: the 09:00 run already happened.
    t.setClock(at("2026-10-12T09:01:20"));
    await t.triggers().tick();
    expect(t.fired).toHaveLength(1);
    // The next day.
    t.setClock(at("2026-10-12T09:00:10") + DAY);
    await t.triggers().tick();
    expect(t.fired).toHaveLength(2);
  });

  it("run a missed time once, however many were missed, with run_once", async () => {
    const t = setup([{ type: "schedule", cron: "0 * * * *" }]); // every hour
    t.live(at("2026-10-12T08:00:00"));
    // The Mac slept from 08:00 to 13:30: five hourly times missed.
    t.setClock(at("2026-10-12T13:30:00"));
    const triggers = t.triggers();
    await triggers.tick();
    await triggers.tick();
    expect(t.fired).toHaveLength(1);
    t.setClock(at("2026-10-12T14:00:30"));
    await triggers.tick();
    expect(t.fired).toHaveLength(2);
  });

  it("pass over a missed time with skip, and run at the next one", async () => {
    const t = setup([{ type: "schedule", cron: "0 9 * * *", missed: "skip" }]);
    t.live(at("2026-10-12T08:00:00"));
    t.setClock(at("2026-10-12T15:00:00"));
    await t.triggers().tick();
    expect(t.fired).toEqual([]);
    t.setClock(at("2026-10-13T09:00:30"));
    await t.triggers().tick();
    expect(t.fired).toHaveLength(1);
  });

  it("never fire for a draft or a paused workflow", async () => {
    const t = setup([{ type: "schedule", cron: "* * * * *" }]);
    t.setClock(at("2026-10-12T09:00:30"));
    await t.triggers().tick(); // no state.json: a draft
    writeState(t.dataDir, "report", { state: "paused", since: at("2026-10-12T08:00:00"), reason: "paused by you" });
    await t.triggers().tick();
    expect(t.fired).toEqual([]);
  });
});

describe("folders", () => {
  const folderSetup = (missed?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "shadow-inbox-"));
    const trigger = { type: "folder_watch", dir, glob: "*.pdf", ...(missed ? { missed } : {}) };
    const t = setup([trigger], { invoice: { type: { type: "file" } } });
    return { ...t, dir };
  };

  it("start a run when a new file has settled, with the file as the input, and only once", async () => {
    const t = folderSetup();
    t.live(Date.now() - 60_000);
    t.setClock(Date.now());
    const triggers = t.triggers({ settleMs: 3_000 });
    writeFileSync(join(t.dir, "inv-1.pdf"), "%PDF");
    writeFileSync(join(t.dir, ".hidden.pdf"), "x");
    writeFileSync(join(t.dir, "inv-2.pdf.crdownload"), "partial");
    writeFileSync(join(t.dir, "notes.txt"), "not a pdf");
    await triggers.tick();
    expect(t.fired).toEqual([]); // seen once: not settled yet
    t.setClock(Date.now() + 3_500);
    await triggers.tick();
    expect(t.fired).toEqual([{ trigger: "folder", provided: { invoice: join(t.dir, "inv-1.pdf") } }]);
    t.setClock(Date.now() + 10_000);
    await triggers.tick();
    await t.triggers().tick(); // a restart doesn't start it again
    expect(t.fired).toHaveLength(1);
    triggers.stop();
  });

  it("ignore files that were there before the workflow went live", async () => {
    const t = folderSetup();
    writeFileSync(join(t.dir, "old.pdf"), "%PDF");
    t.live(Date.now() + 5_000);
    t.setClock(Date.now() + 10_000);
    const triggers = t.triggers({ settleMs: 0 });
    await triggers.tick();
    await triggers.tick();
    expect(t.fired).toEqual([]);
  });

  it("let a file wait its turn while the workflow's previous run is going", async () => {
    const t = folderSetup();
    t.live(Date.now() - 60_000);
    t.setClock(Date.now());
    const triggers = t.triggers({ settleMs: 0 });
    t.setBusy({ id: "r0", status: "waiting" } as RunRow);
    writeFileSync(join(t.dir, "inv.pdf"), "%PDF");
    await triggers.tick();
    await triggers.tick();
    expect(t.fired).toEqual([]);
    t.setBusy(undefined);
    await triggers.tick();
    expect(t.fired).toHaveLength(1);
    triggers.stop();
  });

  it("pass over files that arrived while Shadow wasn't running, with skip", async () => {
    const t = folderSetup("skip");
    mkdirSync(t.dir, { recursive: true });
    t.live(Date.now() - 60_000);
    writeFileSync(join(t.dir, "while-off.pdf"), "%PDF");
    t.setClock(Date.now() + 1_000); // the daemon starts after the file arrived
    const triggers = t.triggers({ settleMs: 0 });
    await triggers.tick();
    await triggers.tick();
    expect(t.fired).toEqual([]);
    triggers.stop();
  });
});
