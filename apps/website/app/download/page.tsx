// Download: the .dmg, what you need, the four setup steps, what to do if something is off, the questions people
// ask, and how to build it from the source.
import type { Metadata } from "next";
import { FAQ } from "../../components/FAQ";
import { Band, DownloadButton, More, Orb } from "../../components/ui";
import { LINKS, FAQ as QUESTIONS, REQUIREMENTS, TROUBLE } from "../../lib/content";

export const metadata: Metadata = {
  title: "Download",
  description: "Download Shadow for Mac: one app. Sign in with Google, connect Chrome, and record your first task.",
};

const SETUP = [
  {
    title: "Open it",
    text: "Drag Shadow to Applications and open it. Apple hasn't checked it yet, so the first time macOS stops it: let it through once with Open Anyway, as shown above. After that it opens like any app.",
  },
  {
    title: "Sign in",
    text: "Press Sign in. Your browser opens Shadow's sign-in page: choose your Google account. No API key, nothing to paste.",
  },
  {
    title: "Chrome",
    text: "Press Connect Chrome. In chrome://extensions turn on Developer mode, press Load unpacked and pick the folder Shadow shows you. In the extension's Details, allow access to file URLs.",
  },
  {
    title: "Permissions",
    text: "Allow Accessibility if you want Mac apps recorded. Screen Recording and the microphone only if you want screenshots and narration.",
  },
];

// Shadow is signed ad hoc, not notarised (no paid Apple Developer account). Since macOS 15, right-click → Open no
// longer lets such an app through: Privacy & Security's Open Anyway does, on every version.
const FIRST_OPEN = [
  {
    title: "Open it once",
    text: "Open Shadow from Applications. macOS says Apple could not verify it is free of malware. Press Done, not Move to Trash.",
  },
  {
    title: "Open Anyway",
    text: "Open System Settings → Privacy & Security and scroll down to Security. Next to “Shadow” was blocked, press Open Anyway.",
  },
  {
    title: "Confirm",
    text: "Press Open Anyway again and enter your Mac's password. From then on Shadow opens like any app. A new version asks once more.",
  },
];

export default function Download() {
  return (
    <>
      <Band tone="night" className="hero page-hero" label="Download Shadow">
        <div className="wrap">
          <Orb />
          <p className="eyebrow" data-reveal>
            Download
          </p>
          <h1 className="hero-title" data-reveal>
            Get Shadow.
          </h1>
          <p className="lead" data-reveal>
            One app for your Mac. Open it, sign in with Google, connect Chrome, and record your first task.
          </p>
          <div className="actions" data-reveal>
            <DownloadButton label="Download the .dmg" />
            <More href={LINKS.repo}>Source on GitHub</More>
          </div>
          <p className="fine" data-reveal>
            For Macs with Apple silicon, macOS 14 or later. Not yet verified by Apple:{" "}
            <a href="#first-open">how to open it the first time</a>.
          </p>
        </div>
      </Band>

      <Band tone="light" id="first-open" label="Opening it the first time">
        <div className="wrap-wide">
          <div className="section-head" data-reveal>
            <p className="eyebrow">The first time</p>
            <h2 className="headline">Not verified by Apple, yet.</h2>
            <p className="lead">
              Shadow is open source and signed by its makers, but not notarised by Apple: that takes a paid Apple
              Developer account. So macOS stops it the first time. Let it through once, in three steps.
            </p>
          </div>
          <ol className="setup">
            {FIRST_OPEN.map((item) => (
              <li key={item.title} data-reveal>
                <h3 className="card-title">{item.title}</h3>
                <p className="body">{item.text}</p>
              </li>
            ))}
          </ol>
          <p className="fine" style={{ marginTop: 24 }} data-reveal>
            On macOS 14 you can instead right-click Shadow, choose Open, then Open again. If macOS still refuses, run
            xattr -dr com.apple.quarantine /Applications/Shadow.app in Terminal.
          </p>
        </div>
      </Band>

      <Band tone="white" label="What you need">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">What you need</p>
            <h2 className="headline">Three things, and a task you repeat.</h2>
          </div>
          <div className="reqs" data-reveal>
            {REQUIREMENTS.map((item) => (
              <div key={item.title}>
                <h3>{item.title}</h3>
                <p className="body">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </Band>

      <Band tone="light" id="setup" label="Set up">
        <div className="wrap-wide">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Set up</p>
            <h2 className="headline">Ready in four steps.</h2>
            <p className="lead">
              Drag Shadow to Applications and open it. A setup window walks you through these; then press Open Shadow
              and record your first task from its window.
            </p>
          </div>
          <ol className="setup">
            {SETUP.map((item) => (
              <li key={item.title} data-reveal>
                <h3 className="card-title">{item.title}</h3>
                <p className="body">{item.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </Band>

      <Band tone="white" label="If something is off">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">If something is off</p>
            <h2 className="headline">Quick fixes.</h2>
          </div>
          <div className="tiles two">
            {TROUBLE.map((item) => (
              <article key={item.q} className="tile" data-reveal>
                <h3 className="card-title">{item.q}</h3>
                <p className="body">{item.a}</p>
              </article>
            ))}
          </div>
          <p className="fine" style={{ marginTop: 24 }} data-reveal>
            Logs are in ~/Library/Logs/Shadow, and Console.app shows them.
          </p>
        </div>
      </Band>

      <Band tone="light" id="faq" label="Questions">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Questions</p>
            <h2 className="headline">What people ask.</h2>
          </div>
          <div data-reveal>
            <FAQ items={QUESTIONS} />
          </div>
        </div>
      </Band>

      <Band tone="white" label="From the source">
        <div className="wrap center">
          <div className="section-head center" data-reveal style={{ marginBottom: 32 }}>
            <p className="eyebrow">From the source</p>
            <h2 className="headline">Build it yourself.</h2>
            <p className="lead">
              Shadow is open source. With Node 22 and the Xcode command line tools, pnpm install and then pnpm package
              build the same .dmg.
            </p>
          </div>
          <div data-reveal>
            <More href={`${LINKS.repo}/blob/main/DEVELOPMENT.md`}>Read the guide on GitHub</More>
          </div>
        </div>
      </Band>
    </>
  );
}
