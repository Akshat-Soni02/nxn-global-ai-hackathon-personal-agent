// The automation window's tabs, by the names steps give them (spec 2.4). The first tab is the window's own; a step with
// no tab, or tab "main", runs there. Every other name gets a tab the first time it is used and the same tab after that,
// so a recording that copied in one tab and pasted in another replays the same way, without reloading either page.
// Kept in chrome.storage.session (toJSON/from), since the service worker may be stopped between steps.
export class TabMap {
  private byName = new Map<string, number>();
  // Tabs a run's page opened by itself (a link with target=_blank, window.open), not named by a step yet, by run (A5).
  private opened: [string, number][] = [];
  constructor(private first?: number) {}

  static from(json: { first?: number; byName: [string, number][]; opened?: [string, number][] }): TabMap {
    const map = new TabMap(json.first);
    for (const [name, id] of json.byName) map.byName.set(name, id);
    map.opened = [...(json.opened ?? [])];
    return map;
  }
  toJSON(): { first?: number; byName: [string, number][]; opened: [string, number][] } {
    return { first: this.first, byName: [...this.byName], opened: [...this.opened] };
  }
  // A page in one of the run's tabs opened a tab: the next new name the run's steps use is that tab, so a step after a
  // click that opened the job posting acts on the posting, not on a blank tab (A5).
  noteOpened(id: number, owner?: string): void {
    this.opened.push([owner ?? "", id]);
  }
  adoptOpened(name: string, owner?: string): number | undefined {
    const at = this.opened.findLastIndex(([who]) => who === (owner ?? ""));
    if (at < 0) return undefined;
    const [, id] = this.opened[at] as [string, number];
    this.opened.splice(at, 1);
    this.remember(name, id, owner);
    return id;
  }
  get main(): number | undefined {
    return this.first;
  }
  setMain(id: number): void {
    this.first = id;
  }
  // A named tab belongs to the run that opened it (its `owner`, the run id): two runs may both use a tab called "Sheet",
  // and one run ending must not close the tabs another run kept while it waits for you.
  private key = (name: string, owner?: string) => (owner ? `${owner}\u0000${name}` : name);
  lookup(name: string | undefined, owner?: string): number | undefined {
    return !name || name === "main" ? this.first : this.byName.get(this.key(name, owner));
  }
  remember(name: string, id: number, owner?: string): void {
    this.byName.set(this.key(name, owner), id);
  }
  // A run is over: its tabs are no longer ours to find (they are closed by the caller, from extras(owner)).
  forgetOwner(owner: string): void {
    for (const key of [...this.byName.keys()]) if (key.startsWith(`${owner}\u0000`)) this.byName.delete(key);
    this.opened = this.opened.filter(([who]) => who !== owner);
  }
  // A tab that closed (you closed it, or the run ended).
  forget(id: number): void {
    for (const [name, tab] of this.byName) if (tab === id) this.byName.delete(name);
    this.opened = this.opened.filter(([, tab]) => tab !== id);
    if (this.first === id) this.first = undefined;
  }
  has(id: number): boolean {
    return id === this.first || [...this.byName.values()].includes(id) || this.opened.some(([, tab]) => tab === id);
  }
  // The tabs to close when a run ends: all but the first. With an owner, only that run's; without, every run's (the
  // daemon went away, so nothing is waiting).
  extras(owner?: string): number[] {
    const own = owner ? [...this.byName].filter(([key]) => key.startsWith(`${owner}\u0000`)) : [...this.byName];
    const opened = this.opened.filter(([who]) => !owner || who === owner).map(([, id]) => id);
    return [...new Set([...own.map(([, id]) => id), ...opened])].filter((id) => id !== this.first);
  }
}
