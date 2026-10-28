// Where "Back" goes from a screen (W3): a workflow or a run to its list, a re-record to the workflow it was started
// from, and Record to Workflows, where what it makes lands. The lists and the other tabs have no Back. `route` is the
// address split into parts ("#/runs/r-9" → ["runs", "r-9"]).
export interface Back {
  label: string;
  href: string;
}

export function backLink(route: string[]): Back | undefined {
  const [screen, id, sub] = route;
  if (screen === "workflows" && id) return { label: "Workflows", href: "#/workflows" };
  if (screen === "runs" && id) return { label: "Runs", href: "#/runs" };
  if (screen === "record") {
    return id === "again" && sub
      ? { label: "The workflow", href: `#/workflows/${sub}` }
      : { label: "Workflows", href: "#/workflows" };
  }
  return undefined;
}
