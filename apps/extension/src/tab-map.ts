// The automation window's tabs, by the names steps give them (spec 2.4). The first tab is the window's own; a step with
// no tab, or tab "main", runs there. Every other name gets a tab the first time it is used and the same tab after that,
// so a recording that copied in one tab and pasted in another replays the same way, without reloading either page.
// Kept in chrome.storage.session (toJSON/from), since the service worker may be stopped between steps.
export class TabMap {
  private byName = new Map<string, number>();
  constructor(private first?: number) {}

  static from(json: { first?: number; byName: [string, number][] }): TabMap {
    const map = new TabMap(json.first);
    for (const [name, id] of json.byName) map.byName.set(name, id);
    return map;
  }
  toJSON(): { first?: number; byName: [string, number][] } {
    return { first: this.first, byName: [...this.byName] };
  }
  get main(): number | undefined {
    return this.first;
  }
  setMain(id: number): void {
    this.first = id;
  }
  lookup(name: string | undefined): number | undefined {
    return !name || name === "main" ? this.first : this.byName.get(name);
  }
  remember(name: string, id: number): void {
    this.byName.set(name, id);
  }
  // A tab that closed (you closed it, or the run ended).
  forget(id: number): void {
    for (const [name, tab] of this.byName) if (tab === id) this.byName.delete(name);
    if (this.first === id) this.first = undefined;
  }
  has(id: number): boolean {
    return id === this.first || [...this.byName.values()].includes(id);
  }
  // The tabs to close when a run ends: all but the first.
  extras(): number[] {
    return [...new Set(this.byName.values())].filter((id) => id !== this.first);
  }
}
