import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Checkpoint, openStore } from "./store.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "shadow-store-")), "shadow.db");

describe("store", () => {
  it("keeps a waiting run's checkpoint, and finds it again after the daemon reopens the file", () => {
    const path = file();
    const store = openStore(path);
    store.startRun({ id: "r1", skillId: "kpi", version: 3, trigger: "manual", startedAt: 1_000 });
    const checkpoint: Checkpoint = {
      version: 3,
      inputs: { week: "2026-10-12" },
      resume: { at: "l1[2] > s3", vars: { week: "2026-10-12", rows: [{ a: 1 }] } },
      waiting: { kind: "approval", path: "l1[2] > s3", stepId: "s3", intent: "send the report" },
    };
    store.updateRun("r1", { status: "waiting", checkpoint });
    store.close();

    const reopened = openStore(path);
    expect(reopened.getRun("r1")).toMatchObject({ status: "waiting", version: 3, checkpoint });
    reopened.updateRun("r1", { status: "succeeded", checkpoint: undefined, endedAt: 2_000 });
    expect(reopened.getRun("r1")?.checkpoint).toBeUndefined();
  });

  it("marks runs the daemon left going as interrupted, and leaves waiting runs waiting", () => {
    const store = openStore(file());
    store.startRun({ id: "going", skillId: "a", version: 1, trigger: "manual", startedAt: 1 });
    store.startRun({ id: "waits", skillId: "a", version: 1, trigger: "manual", startedAt: 2 });
    store.updateRun("waits", { status: "waiting" });
    expect(store.interruptRunning(5)).toEqual(["going"]);
    expect(store.getRun("going")).toMatchObject({ status: "interrupted", endedAt: 5 });
    expect(store.getRun("waits")?.status).toBe("waiting");
  });

  it("takes the first answer to an inbox item, and lists only open items when asked", () => {
    const store = openStore(file());
    const item = store.addItem({ kind: "approval", runId: "r1", title: "Send it?", detail: { path: "s2" } });
    expect(store.listItems({ open: true }).map((i) => i.id)).toEqual([item.id]);
    expect(store.answerItem(item.id, { approved: true }, 10)).toBe(true);
    expect(store.answerItem(item.id, { approved: false }, 11)).toBe(false);
    expect(store.getItem(item.id)).toMatchObject({ answeredAt: 10, answer: { approved: true } });
    expect(store.listItems({ open: true })).toEqual([]);
    expect(store.listItems({ runId: "r1" })).toHaveLength(1);
  });

  it("lists runs newest first, by workflow, and sums what they spent", () => {
    const store = openStore(file());
    store.startRun({ id: "old", skillId: "a", version: 1, trigger: "manual", startedAt: 100 });
    store.startRun({ id: "new", skillId: "a", version: 2, trigger: "schedule", startedAt: 200 });
    store.startRun({ id: "other", skillId: "b", version: 1, trigger: "manual", startedAt: 300 });
    store.updateRun("old", { costUsd: 0.01 });
    store.updateRun("new", { costUsd: 0.02, repaired: true });
    expect(store.listRuns({ skillId: "a" }).map((r) => r.id)).toEqual(["new", "old"]);
    expect(store.getRun("new")?.repaired).toBe(true);
    expect(store.spentSince(150)).toBeCloseTo(0.02);
    expect(store.spentSince(0)).toBeCloseTo(0.03);
  });
});
