// What would stop a run behind Chrome's own UI, answered inside the page of an automation tab only (A5): the page's own
// Print opens a preview over the run, and a permission ask (notifications, location, camera, the clipboard) shows a
// bubble nobody is there to answer. Here print is skipped and each ask is denied, the way a person who says no would,
// without changing any of your Chrome settings. replay.ts runs it in every page of an automation tab (on each new
// document, and once in the page already there). What it blocked is kept in window.__shadowBlocked.
export const PAGE_GUARD = `(() => {
  if (window.__shadowGuarded) return;
  window.__shadowGuarded = true;
  const blocked = (window.__shadowBlocked = window.__shadowBlocked || []);
  const no = (what) => {
    blocked.push(what);
    return new DOMException("denied by Shadow's automation window: " + what, "NotAllowedError");
  };
  window.print = () => {
    blocked.push("print");
  };
  if (window.Notification) {
    try {
      window.Notification.requestPermission = (callback) => {
        blocked.push("notifications");
        if (typeof callback === "function") callback("denied");
        return Promise.resolve("denied");
      };
    } catch {}
  }
  const geo = navigator.geolocation;
  if (geo) {
    const deny = (_ok, fail) => {
      blocked.push("location");
      if (typeof fail === "function") fail({ code: 1, message: "denied by Shadow's automation window" });
    };
    try {
      geo.getCurrentPosition = deny;
      geo.watchPosition = (ok, fail) => {
        deny(ok, fail);
        return 0;
      };
    } catch {}
  }
  if (navigator.mediaDevices) {
    try {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(no("camera or microphone"));
    } catch {}
  }
  if (navigator.clipboard) {
    try {
      navigator.clipboard.readText = () => Promise.reject(no("clipboard"));
      navigator.clipboard.read = () => Promise.reject(no("clipboard"));
    } catch {}
  }
})();`;

// A download Chrome holds for its Save-as dialog: still going, and no file chosen yet (A5).
export function waitingForSaveAs(items: { state?: string; filename?: string }[]): string | undefined {
  return items.some((d) => d.state === "in_progress" && !d.filename)
    ? 'Chrome is asking where to save the download (your setting "Ask where to save each file before downloading"): choose a place in the automation window and go on, or turn that setting off so runs can download on their own'
    : undefined;
}
