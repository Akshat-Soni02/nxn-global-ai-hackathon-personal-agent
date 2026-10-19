// Runs in the page's own JavaScript world (manifest: "world": "MAIN"), where a page's "Copy" button runs. Such a button
// writes the clipboard with navigator.clipboard.writeText, which fires no copy event, so capture (in the extension's
// isolated world) never saw those copies (spec 1.2). This only tells capture what was written, through a window
// message; what the page does is unchanged. Built as a classic script: nothing is exported.
const clip = navigator.clipboard;
if (clip && typeof clip.writeText === "function") {
  const writeText = clip.writeText.bind(clip);
  clip.writeText = (text: string) => {
    try {
      // "/": this same window only (a file:// page's origin is "null", which an origin string can't name).
      window.postMessage({ __shadowCopy: true, text: String(text).slice(0, 2_000) }, "/");
    } catch {
      // never let recording break the page's copy
    }
    return writeText(text);
  };
}
