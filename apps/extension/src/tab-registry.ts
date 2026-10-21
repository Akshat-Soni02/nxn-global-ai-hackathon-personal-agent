// The tabs a recording used (spec 1.12 and 2.4): for each, the first address it showed, its title, its window, the tab
// that opened it, and whether it was already open when Record was pressed. Replay opens each tab at the right place
// from these. A tab opened while recording has its own tab_open in the trace; a tab that was already open is announced
// once, as a tab_open just before its first event, so only tabs actually used appear.
export interface TabSeen {
  tabId: number;
  windowId?: number;
  url?: string;
  title?: string;
  openerTabId?: number;
  preexisting: boolean;
}
type ChromeTab = { id?: number; windowId?: number; url?: string; title?: string; openerTabId?: number };

export class TabRegistry {
  private tabs = new Map<number, TabSeen>();
  private announced = new Set<number>();

  // At Record: every tab already open.
  start(tabs: ChromeTab[]): void {
    this.tabs.clear();
    this.announced.clear();
    for (const t of tabs) {
      if (t.id === undefined) continue;
      this.tabs.set(t.id, {
        tabId: t.id,
        ...(t.windowId !== undefined ? { windowId: t.windowId } : {}),
        ...(t.url ? { url: t.url } : {}),
        ...(t.title ? { title: t.title } : {}),
        ...(t.openerTabId !== undefined ? { openerTabId: t.openerTabId } : {}),
        preexisting: true,
      });
    }
  }

  // A tab opened while recording: already in the trace as tab_open.
  opened(tab: ChromeTab): void {
    if (tab.id === undefined) return;
    this.tabs.set(tab.id, {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      openerTabId: tab.openerTabId,
      preexisting: false,
    });
    this.announced.add(tab.id);
  }

  // The first event from a tab that was open before Record: what to announce first. Undefined after that, for tabs
  // opened while recording, and for tabs never seen.
  firstUse(tabId: number): TabSeen | undefined {
    if (this.announced.has(tabId)) return undefined;
    this.announced.add(tabId);
    return this.tabs.get(tabId);
  }
}
