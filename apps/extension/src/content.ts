// Content script: runs in every page and frame. Captures events only while the daemon has a recording session open.
// TODO(recorder): add listeners, describe targets (ElementDescriptor), and send
//   chrome.runtime.sendMessage({ type: "record.event", id, at, event, value, target }).

let sessionId: string | undefined;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "recording") sessionId = message.sessionId;
});

chrome.runtime.sendMessage({ type: "recording?" }).then(
  (reply) => {
    sessionId = reply?.sessionId;
  },
  () => {},
);

export function isRecording() {
  return sessionId !== undefined;
}
