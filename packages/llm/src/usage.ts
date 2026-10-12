// Adds up what model calls cost. A meter can have a parent (an episode inside a run), and every call counted by the
// child is counted by the parent too. It measures; limits are the caller's.

export interface Usage {
  calls: number;
  input: number;
  output: number;
  costUsd: number;
}

export class UsageMeter {
  private total: Usage = { calls: 0, input: 0, output: 0, costUsd: 0 };
  constructor(private readonly parent?: UsageMeter) {}

  add(input: number, output: number, costUsd: number): void {
    this.total = {
      calls: this.total.calls + 1,
      input: this.total.input + input,
      output: this.total.output + output,
      costUsd: this.total.costUsd + costUsd,
    };
    this.parent?.add(input, output, costUsd);
  }

  child(): UsageMeter {
    return new UsageMeter(this);
  }

  get usage(): Usage {
    return { ...this.total };
  }
}
