// Replay: executes a skill step by step.
// Owned by the replay team. See "Replay" in the design doc.
//
// Planned modules:
//   run.ts        per-step loop: resolve inputs -> wait -> match -> approve -> act -> verify -> retry -> agent -> escalate
//   match.ts      deterministic scoring of candidates against a Locator
//   channels/     web (chrome.debugger, bundled into apps/extension), fs, script
//   agent.ts      LLM fallback via @taskplayer/llm, reads @taskplayer/memory
//   learnback.ts  proposes a new skill version after a verified agent fix

export {};
