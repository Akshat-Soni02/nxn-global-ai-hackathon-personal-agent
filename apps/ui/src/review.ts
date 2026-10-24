// The review on the workflow page (spec 4.3): a badge per change with its why, "not tested" where no test run found
// the step; and, after Stop, the workflow a recording just saved (H24).
import type { RecordingView, Review } from "@shadow/daemon/src/types.ts";

const LABEL = { added: "Added", changed: "Changed", removed: "Removed", moved: "Moved" } as const;

export function badgesOf(review: Review): { step: string; label: string; why?: string; untested: boolean }[] {
  const untested = new Set(review.notTested.map((t) => t.split(":")[0]));
  return review.notes.map((n) => ({
    step: n.step,
    label: LABEL[n.change],
    ...(n.why ? { why: n.why } : {}),
    untested: Boolean(n.unverified) || untested.has(n.step),
  }));
}

// Why the version shown can't do the task yet: the design's reasons, while no one has saved a version on top of it
// (an edit may have added the step that makes the file; the daemon's Go live judges the same way).
export function cantRunNow(review: Review | null | undefined, latest: number): string[] {
  return review?.cantRun?.length && review.version === latest ? review.cantRun : [];
}

// The workflow to open: one a recording saved since the Record screen opened (`seen` is the last recording then).
export function savedSince(seen: string | undefined, last: RecordingView["last"]): string | undefined {
  return last && last.outcome === "saved" && last.skillId && last.sessionId !== seen ? last.skillId : undefined;
}
