// Pictures after events (spec 1.15, 1.16). Chrome takes about two a second (captureVisibleTab), and a newer event used
// to replace a picture still waiting, so a burst kept only its last event's picture and lost the others without a
// word. Now a short queue keeps up to three, dropping the least telling kind first, and whatever can't be taken goes
// in the ledger instead of vanishing.
export interface ShotJob {
  tabId: number;
  eventId: string;
  at: number;
  kind: string;
  // Not before: the page needs a moment to react (400 ms; 1.2 s after a navigation).
  due: number;
  masks?: { x: number; y: number; w: number; h: number }[];
}

const PRIORITY: Record<string, number> = {
  copy: 5,
  select_text: 5,
  click: 4,
  type: 4,
  select: 4,
  check: 4,
  file: 3,
  drop: 3,
  submit: 3,
  key: 3,
  navigate: 2,
  tab_switch: 2,
};
export const GAP_MS = 600;

export class ShotQueue {
  private jobs: ShotJob[] = [];
  constructor(private readonly max = 3) {}

  // Adds a job; returns the one dropped to make room (the least telling, oldest first), for the ledger.
  add(job: ShotJob): ShotJob | undefined {
    this.jobs.push(job);
    if (this.jobs.length <= this.max) return undefined;
    const victim = [...this.jobs].sort((a, b) => (PRIORITY[a.kind] ?? 1) - (PRIORITY[b.kind] ?? 1) || a.at - b.at)[0];
    this.jobs = this.jobs.filter((j) => j !== victim);
    return victim;
  }

  // The job to take now: the oldest one that is due, once the last picture was at least GAP_MS ago.
  next(now: number, lastShot: number): ShotJob | undefined {
    if (now < lastShot + GAP_MS) return undefined;
    const due = this.jobs.filter((j) => j.due <= now).sort((a, b) => a.at - b.at)[0];
    if (due) this.jobs = this.jobs.filter((j) => j !== due);
    return due;
  }

  // How long until a job may be taken, or undefined when there is none.
  wake(now: number, lastShot: number): number | undefined {
    if (this.jobs.length === 0) return undefined;
    return Math.max(0, Math.max(lastShot + GAP_MS, Math.min(...this.jobs.map((j) => j.due))) - now);
  }

  clear(): ShotJob[] {
    const all = this.jobs;
    this.jobs = [];
    return all;
  }
}
