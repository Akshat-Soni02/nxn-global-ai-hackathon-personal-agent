// Privacy: the four promises, how the words on screen are read and masked on the Mac, what stays there and for how
// long, what leaves it (text only, with your own key) and what never does, and the switches that control it.
import type { Metadata } from "next";
import { Icon } from "../../components/Icons";
import { Band, ClosingCTA, PageHero } from "../../components/ui";
import { STAYS } from "../../lib/content";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "There is no Shadow cloud. Your workflows, inbox and memory stay on your Mac; screen text is masked before it leaves; nothing outward happens without your approval.",
};

const LEAVES = [
  "The goal you wrote and how often it runs.",
  "The steps you recorded, without secret values.",
  "What you said, as text.",
  "The words read from screenshots, with private details masked.",
  "For a repair: the step that failed and an outline of the page.",
];
const NEVER = [
  "Passwords. They are never recorded.",
  "Your voice. The audio stays on your Mac.",
  "Pictures, unless you allow them. Then they are blacked out first.",
];
const CONTROLS = [
  { title: "Three switches", text: "Screenshots, your voice and pictures are each off until you turn them on." },
  { title: "Forget", text: "See what Shadow remembers from your answers, and forget any of it, in Settings." },
  { title: "Approvals", text: "Mark any step to wait for you. Steps that send, pay or delete always do." },
  { title: "Roll back", text: "Every change, by you or by a repair, is a version you can go back to." },
];

export default function Privacy() {
  return (
    <>
      <PageHero
        eyebrow="Privacy"
        title="Private by design."
        lead="Shadow watches you work, so it was built to keep what it sees. There is no Shadow cloud: your Mac is the server, and the model is called with your own key."
      />

      <Band tone="white" label="Four promises">
        <div className="wrap">
          <div className="tiles two">
            <article className="tile big" data-reveal>
              <Icon name="mac" className="icon" />
              <h2 className="card-title">Your Mac is the server</h2>
              <p className="body">
                The app on your Mac holds your workflows, your inbox and what Shadow remembers. It calls the model on
                Nebius Token Factory directly, with your key from your Keychain. Nothing passes through us.
              </p>
            </article>
            <article className="tile big" data-reveal>
              <Icon name="words" className="icon" />
              <h2 className="card-title">Words, not pictures</h2>
              <p className="body">
                With your consent Shadow takes a picture at each step and reads the words on it on your Mac. Emails,
                phone and card numbers, keys and the words you name are masked before anything leaves.
              </p>
            </article>
            <article className="tile big" data-reveal>
              <Icon name="hand" className="icon" />
              <h2 className="card-title">Nothing outward without you</h2>
              <p className="body">
                Steps that send, pay, publish or delete wait for your approval. A repair can never add one, turn an
                approval off, or reach a site you didn't use.
              </p>
            </article>
            <article className="tile big" data-reveal>
              <Icon name="timer" className="icon" />
              <h2 className="card-title">Gone in a day</h2>
              <p className="body">
                A recording's raw files (events, pictures, audio) are deleted 24 hours after the workflow is saved. The
                workflow keeps only what running it needs.
              </p>
            </article>
          </div>
        </div>
      </Band>

      <Band tone="night" label="Masking">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Masking</p>
            <h2 className="headline">What the model sees is what you'd share.</h2>
            <p className="lead">
              The words on screen are read on your Mac by macOS itself. Private details are blacked out before the text
              leaves, so the model learns the task, not your accounts.
            </p>
          </div>
          <div className="tile big" data-reveal>
            <p className="masked">
              Invoice from <span className="m" style={{ width: "9.5em" }} /> · paid with card ending{" "}
              <span className="m" style={{ width: "3em" }} />
              <br />
              Reply to <span className="m" style={{ width: "13em" }} /> · total 6,400 EUR · due 30 Oct
            </p>
            <p className="fine" style={{ marginTop: 16 }}>
              The words Shadow sends for one screenshot: the email address and the card number masked on your Mac.
            </p>
          </div>
        </div>
      </Band>

      <Band tone="light" id="stays" label="What stays on your Mac">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">On your Mac</p>
            <h2 className="headline">What stays, and for how long.</h2>
          </div>
          <div className="table-wrap" data-reveal>
            <table className="stays">
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Where</th>
                  <th scope="col">How long</th>
                </tr>
              </thead>
              <tbody>
                {STAYS.map((row) => (
                  <tr key={row.thing}>
                    <td>{row.thing}</td>
                    <td>{row.where}</td>
                    <td>{row.howLong}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Band>

      <Band tone="white" id="leaves" label="What leaves your Mac">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Off your Mac</p>
            <h2 className="headline">Text only. With your key.</h2>
            <p className="lead">
              What Shadow sends goes to Nebius Token Factory, to the NVIDIA Nemotron models. Turn on Zero Data Retention
              for your account and it isn't kept there.
            </p>
          </div>
          <div className="leaves">
            <div className="tile big" data-reveal>
              <h3 className="card-title" style={{ marginBottom: 20 }}>
                Leaves your Mac, as text
              </h3>
              <ul className="checks checks-not">
                {LEAVES.map((line) => (
                  <li key={line}>
                    <Icon name="dash" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="tile big" data-reveal>
              <h3 className="card-title" style={{ marginBottom: 20 }}>
                Never leaves it
              </h3>
              <ul className="checks">
                {NEVER.map((line) => (
                  <li key={line}>
                    <Icon name="lock" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Band>

      <Band tone="light" id="controls" label="Your controls">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">In your hands</p>
            <h2 className="headline">You decide, and can change your mind.</h2>
          </div>
          <div className="tiles four">
            {CONTROLS.map((item) => (
              <article key={item.title} className="tile" data-reveal>
                <h3 className="card-title">{item.title}</h3>
                <p className="body">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </Band>

      <ClosingCTA title="Private, and yours." lead="Everything Shadow learns stays on your Mac." />
    </>
  );
}
