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
    text: "Drag Shadow to Applications. The first time, right-click it and choose Open, then Open again: it is signed by its makers, not yet by Apple. After that it opens like any app.",
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
            macOS 14 or later. Signed by its makers, not by Apple: the first time, right-click the app and choose Open.
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
            <More href={`${LINKS.repo}#running-from-the-repository`}>Read the guide on GitHub</More>
          </div>
        </div>
      </Band>
    </>
  );
}
