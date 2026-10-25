// The browser page a person signs in on (GET /signin?code=ABCD-EFGH). It shows the code the app shows, so they can
// check it's their Mac asking, signs them in, and sends the proof with the code to /v1/auth/device/approve.
// "firebase": Google or email and password through the Firebase JS SDK (Identity Platform). "dev": an email field.
import type { Config } from "./config.ts";

const FIREBASE_JS = "https://www.gstatic.com/firebasejs/10.12.2";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function signinPage(config: Config, code: string): string {
  const firebaseConfig = JSON.stringify({
    apiKey: config.firebase.apiKey ?? "",
    authDomain: config.firebase.authDomain ?? "",
    projectId: config.firebase.projectId ?? "",
  });
  const dev = config.auth === "dev";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Shadow</title>
<style>
  :root { color-scheme: light dark; --bg: #fbfbf8; --fg: #1c1c22; --muted: #66666f; --card: #fff; --line: #d9d9e0; --accent: #1f5fbf; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16161a; --fg: #ececf1; --muted: #a0a0aa; --card: #1f1f25; --line: #33333b; --accent: #6ea0ff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; }
  main { max-width: 420px; margin: 10vh auto; padding: 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p { color: var(--muted); margin: 0 0 18px; }
  .code { font: 600 26px/1 ui-monospace, Menlo, monospace; letter-spacing: 3px; padding: 14px; text-align: center; border: 1px dashed var(--line); border-radius: 10px; margin-bottom: 20px; }
  button, input { font: inherit; width: 100%; box-sizing: border-box; border-radius: 10px; padding: 11px 14px; }
  input { border: 1px solid var(--line); background: transparent; color: var(--fg); margin-bottom: 10px; }
  button { border: 0; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; margin-bottom: 10px; }
  button.secondary { background: transparent; color: var(--accent); border: 1px solid var(--line); }
  .or { text-align: center; color: var(--muted); font-size: 13px; margin: 6px 0 14px; }
  #status { min-height: 1.5em; font-size: 14px; }
  .ok { color: #2e8b57; } .err { color: #c0392b; }
</style>
</head>
<body>
<main><div class="card">
  <h1>Sign in to Shadow</h1>
  <p>Check that this is the code Shadow shows on your Mac.</p>
  <div class="code">${esc(code || "no code")}</div>
  ${
    dev
      ? `<input id="email" type="email" placeholder="you@example.com" autocomplete="email">
  <button id="dev">Sign in (local development)</button>`
      : `<button id="google">Continue with Google</button>
  <div class="or">or with email</div>
  <input id="email" type="email" placeholder="you@example.com" autocomplete="email">
  <input id="password" type="password" placeholder="Password (new accounts: at least 6 characters)" autocomplete="current-password">
  <button id="emailBtn" class="secondary">Continue with email</button>`
  }
  <div id="status"></div>
</div></main>
<script type="module">
const code = ${JSON.stringify(code)};
const status = document.getElementById("status");
const say = (text, cls) => { status.textContent = text; status.className = cls || ""; };
async function approve(proof) {
  say("Linking your Mac…");
  const res = await fetch("/v1/auth/device/approve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_code: code, ...proof }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) say("Done. You can close this tab and go back to Shadow.", "ok");
  else say(body.error_description || body.error || "That didn't work. Try again from Shadow.", "err");
}
${
  dev
    ? `document.getElementById("dev").onclick = () => approve({ email: document.getElementById("email").value });`
    : `import { initializeApp } from "${FIREBASE_JS}/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "${FIREBASE_JS}/firebase-auth.js";
const auth = getAuth(initializeApp(${firebaseConfig}));
const done = async (cred) => approve({ id_token: await cred.user.getIdToken() });
document.getElementById("google").onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).then(done).catch((e) => say(e.message, "err"));
document.getElementById("emailBtn").onclick = async () => {
  const email = document.getElementById("email").value, password = document.getElementById("password").value;
  try { await done(await signInWithEmailAndPassword(auth, email, password)); }
  catch (e) {
    if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential") {
      try { await done(await createUserWithEmailAndPassword(auth, email, password)); } catch (e2) { say(e2.message, "err"); }
    } else say(e.message, "err");
  }
};`
}
</script>
</body>
</html>`;
}
