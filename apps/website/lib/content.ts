// Everything the site says that is a fact about Shadow, in one place. Each line comes from README.md,
// docs/product.md or docs/design-ui.md: the site promises nothing the app does not do today.

const REPO = "https://github.com/Akshat-Soni02/nxn-global-ai-hackathon-personal-agent";

export const LINKS = {
  // The latest GitHub Release's .dmg, by the stable name scripts/release.ts uploads: the file itself, not a page.
  download: `${REPO}/releases/latest/download/Shadow.dmg`,
  releases: `${REPO}/releases/latest`,
  repo: REPO,
  docs: `${REPO}/tree/main/docs`,
  product: `${REPO}/blob/main/docs/product.md`,
  hackathon: "https://nebiusglobalaihackathon.devpost.com/",
} as const;

export const NAV = [
  { href: "/", label: "Overview" },
  { href: "/how-it-works/", label: "How it works" },
  { href: "/use-cases/", label: "Use cases" },
  { href: "/privacy/", label: "Privacy" },
] as const;

export const REQUIREMENTS = [
  { title: "macOS 14 Sonoma or later", text: "Shadow lives on the Mac you work on." },
  { title: "Google Chrome", text: "For the web pages Shadow records and runs." },
  {
    title: "A Google account",
    text: "To sign in. The models and the apps you connect come with it: no API key to find or paste.",
  },
] as const;

export const MODELS = [
  { name: "Nemotron 3 Super", role: "Understands a recording and repairs a step that broke." },
  { name: "Nemotron 3.5 Lightning", role: "Runs the small reading steps: summarise, classify, pick." },
  { name: "GLM-5.3-Flash", role: "Describes a blacked-out picture, and only if you allow pictures." },
] as const;

export type Case = {
  id: string;
  title: string;
  when: string;
  where: string;
  once: string;
  every: string;
  steps: { kind: string; text: string; depth?: number; flag?: string; tone?: "ai" | "if" | "loop" }[];
};

// Tasks like the ones Shadow has been shown. Each is a workflow it can hold: loops, branches, AI steps, approvals.
export const CASES: Case[] = [
  {
    id: "kpi",
    title: "This week's numbers, in the KPI sheet",
    when: "Every Monday at 09:00",
    where: "Chrome",
    once: "Open the report email, read three numbers, type them into the sheet.",
    every: "Shadow finds the newest report, reads the numbers, and writes the row. It waits for your OK first.",
    steps: [
      { kind: "web", text: 'Open the newest email from "Reporting Bot"' },
      { kind: "AI", text: "Read Revenue, Signups and Churn", tone: "ai" },
      { kind: "web", text: 'Open the "KPI 2026" sheet' },
      { kind: "web", text: "Write the week and the numbers in a new row", flag: "approval" },
    ],
  },
  {
    id: "downloads",
    title: "Everything in Downloads, filed",
    when: "When a file appears in Downloads",
    where: "Finder",
    once: "Drag a PDF into Invoices, a screenshot into Screenshots, leave the rest.",
    every: "Each new file goes where you would have put it. Anything it can't place stays put.",
    steps: [
      { kind: "for each", text: "file in Downloads", tone: "loop" },
      { kind: "if", text: "it is a PDF invoice", depth: 1, tone: "if" },
      { kind: "files", text: "Move it to Invoices / 2026", depth: 2 },
      { kind: "else if", text: "it is a screenshot", depth: 1, tone: "if" },
      { kind: "files", text: "Move it to Screenshots", depth: 2 },
    ],
  },
  {
    id: "jobs",
    title: "New YC jobs, picked for you",
    when: "Every morning",
    where: "Chrome",
    once: "Open the jobs page, pick the ones worth a look, add each to your sheet.",
    every: "Shadow reads the list, lets the AI pick up to five, and adds each with the right label.",
    steps: [
      { kind: "web", text: "Open the YC jobs page" },
      { kind: "AI", text: "Pick up to 5 remote or new-grad jobs", tone: "ai" },
      { kind: "for each", text: "picked job", tone: "loop" },
      { kind: "if", text: "remote → mark it Remote", depth: 1, tone: "if" },
      { kind: "web", text: "Save the row", depth: 1, flag: "approval" },
    ],
  },
  {
    id: "digest",
    title: "A morning digest of Hacker News",
    when: "Every day at 08:00",
    where: "Chrome and TextEdit",
    once: "Read the front page, note what matters, save it.",
    every: "Shadow reads the top stories, summarises them, and leaves the note in TextEdit.",
    steps: [
      { kind: "web", text: "Read the front page stories" },
      { kind: "AI", text: "Summarise what matters to you", tone: "ai" },
      { kind: "mac app", text: "Write the digest in TextEdit" },
    ],
  },
];

export const STAYS = [
  {
    thing: "Your workflows and their versions",
    where: "Shadow's folder on your Mac",
    howLong: "Until you delete them",
  },
  { thing: "What each run did", where: "Shadow's folder on your Mac", howLong: "Kept" },
  { thing: "The inbox and the list of runs", where: "Shadow's folder on your Mac", howLong: "Kept" },
  {
    thing: "What Shadow remembers from your answers",
    where: "Shadow's folder on your Mac",
    howLong: "Until you press Forget",
  },
  {
    thing: "A recording's raw files: events, pictures, audio",
    where: "Shadow's folder on your Mac",
    howLong: "Deleted 24 hours after the workflow is saved",
  },
  {
    thing: "Your sign-in (a device token, not a password)",
    where: "The macOS Keychain",
    howLong: "Until you sign out",
  },
] as const;

export const FAQ = [
  {
    q: "Does it click things while I'm not looking?",
    a: "Only once a workflow is live with a Frequency, and never a step that sends, pays or deletes without your approval in the inbox.",
  },
  {
    q: "Can it reach a site I never used?",
    a: "No. A repair may not add a new site, add a step that sends something, or turn an approval off.",
  },
  {
    q: "What happens when a website changes?",
    a: "Shadow repairs the step, keeps the fix only when it can see it worked, and saves it as a new version. An inbox card says what changed, and Roll back undoes it in one click.",
  },
  {
    q: "What if it can't do a step, like a login code?",
    a: "The run waits in your inbox. Do the step by hand in the automation window and press “I did it by hand: go on”.",
  },
  {
    q: "Where does the model run?",
    a: "On Nebius Token Factory, through Shadow's service, with Zero Data Retention: NVIDIA Nemotron 3 Super and Nemotron 3.5 Lightning, and GLM-5.3-Flash only for blacked-out pictures if you allow them.",
  },
  {
    q: "Can I see what it did?",
    a: "Yes. Runs shows each run step by step, with what a repair changed and what the model cost.",
  },
  {
    q: "Why does macOS warn me the first time I open it?",
    a: "Shadow is signed by its makers, not by Apple, for the hackathon. Right-click the app and choose Open the first time.",
  },
  {
    q: "Is it open source?",
    a: "Yes, under the MIT licence. The source, the design notes and every decision behind them are on GitHub.",
  },
] as const;

export const TROUBLE = [
  {
    q: "Record does nothing",
    a: "Shadow's background service isn't running. The menu bar says so and offers Start.",
  },
  { q: "“Not signed in”", a: "Settings → Account → Sign in, and finish in the browser page it opens." },
  {
    q: "“Shadow can't be opened”",
    a: "The first time only: right-click Shadow in Applications, choose Open, then Open again.",
  },
  {
    q: "Chrome says “not connected”",
    a: "Settings → Connect Chrome, then reload the extension in chrome://extensions.",
  },
  {
    q: "Mac apps aren't recorded",
    a: "System Settings → Privacy & Security → Accessibility → turn Shadow on. After an update, turn it off and on again.",
  },
] as const;
