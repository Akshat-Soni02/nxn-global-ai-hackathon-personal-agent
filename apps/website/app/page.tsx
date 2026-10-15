// Overview: what Shadow is in one look, then why it is worth trying, how it works (the story the scroll plays), the
// privacy promise, what people hand to it, the models underneath, and the download.
import Link from "next/link";
import { Icon } from "../components/Icons";
import { HeroMotion } from "../components/motion/HeroMotion";
import { StoryScroll } from "../components/motion/StoryScroll";
import { InboxCard, Pill, Window } from "../components/product/Mocks";
import { Scaled } from "../components/product/Scaled";
import { InvoiceTree, KpiTree } from "../components/product/Tree";
import { Band, ClosingCTA, DownloadButton, More, Orb } from "../components/ui";
import { CASES, MODELS } from "../lib/content";

export default function Overview() {
  return (
    <>
      <Band tone="night" className="hero" label="Shadow">
        <HeroMotion>
          <div className="wrap">
            <Orb />
            <p className="eyebrow" data-hero-fade>
              Shadow for Mac
            </p>
            <h1 className="hero-title">
              <span className="hero-line">Show it once.</span>
              <span className="hero-line" style={{ color: "var(--on-night-2)" }}>
                It does the rest.
              </span>
            </h1>
            <p className="lead" data-hero-fade>
              Do a task on your Mac one time while Shadow watches. From then on it does it for you: in Chrome, in your
              Mac apps, with your files. <strong>When a website changes, it fixes itself and tells you.</strong>
            </p>
            <div className="actions" data-hero-fade>
              <DownloadButton />
              <More href="/how-it-works/">See how it works</More>
            </div>
            <p className="fine" data-hero-fade>
              macOS 14 or later · Free and open source · Your Mac, your own model key
            </p>
          </div>
          <div className="hero-stage wrap-wide" data-hero-fade>
            <div data-hero-window>
              <Scaled width={1080}>
                <div className="hero-drawing">
                  <Window id="hero" badge={3}>
                    <p className="w-title">Waiting for you</p>
                    <p className="w-sub">3 to look at</p>
                    <div className="w-cols">
                      <div>
                        <InboxCard
                          kind="Approval"
                          title="Approve: write this week's numbers in the KPI sheet"
                          buttons={["Approve", "Deny"]}
                        />
                        <InboxCard
                          kind="Repaired"
                          tone="ok"
                          title={'The portal renamed "Submit" to "Submit invoice". Saved as v2.'}
                          buttons={["Looks right", "Roll back"]}
                        />
                        <InboxCard
                          kind="Question"
                          tone="ask"
                          title="For a new-grad job, what goes in the Kind column?"
                          buttons={["Mark it New grad", "Skip it"]}
                          free
                        />
                      </div>
                      <div className="w-tree-card">
                        <p>This week's numbers → KPI sheet</p>
                        <KpiTree />
                      </div>
                    </div>
                  </Window>
                  <Pill state="idle" label="Record" />
                </div>
              </Scaled>
            </div>
          </div>
          <p className="sr-only">
            Shadow's window: the inbox with an approval waiting, a repair saved as version 2 and a question, beside the
            workflow it learned. In front of it floats the round Record button.
          </p>
        </HeroMotion>
      </Band>

      <Band tone="light" label="Why Shadow">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Why Shadow</p>
            <h2 className="headline">Teach it the way you'd teach a colleague.</h2>
            <p className="lead">
              Show it, and say why if you like. Shadow learns the task, not just the clicks: what changes each time,
              what repeats, and what only you should decide.
            </p>
          </div>
          <div className="tiles three">
            <article className="tile" data-reveal>
              <Icon name="watch" className="icon" />
              <h3 className="card-title">Learns by watching</h3>
              <p className="body">
                Do the task once, your usual way, in Chrome, Mac apps and Finder. Shadow turns it into steps you can
                read and change.
              </p>
            </article>
            <article className="tile" data-reveal>
              <Icon name="clock" className="icon" />
              <h3 className="card-title">Runs on its own</h3>
              <p className="body">
                On a schedule, when a file lands in a folder, or when you press Run. Anything that sends, pays or
                deletes waits for your OK.
              </p>
            </article>
            <article className="tile" data-reveal>
              <Icon name="repair" className="icon" />
              <h3 className="card-title">Fixes itself</h3>
              <p className="body">
                A renamed button or a new banner doesn't stop it. Shadow repairs the step, keeps the fix only with proof
                it worked, and saves it as a new version.
              </p>
            </article>
          </div>
        </div>
      </Band>

      <Band tone="white" label="How it works">
        <div className="wrap">
          <div className="section-head center" data-reveal>
            <p className="eyebrow">How it works</p>
            <h2 className="headline">One recording. A workflow that keeps running.</h2>
          </div>
        </div>
        <StoryScroll>
          <div className="wrap-wide story-grid">
            <ol className="story-steps">
              <li className="story-step">
                <h3>Record</h3>
                <p>
                  Press the round Record button and do the task. Shadow notes each click and keystroke in Chrome, in Mac
                  apps and in Finder, and, only if you allow it, the words on screen and what you say.
                </p>
              </li>
              <li className="story-step">
                <h3>Understand</h3>
                <p>
                  NVIDIA Nemotron turns the recording into a workflow you can read: a loop for repeated work, a branch
                  for “only if”, an AI step for reading. It asks only what it can't tell.
                </p>
              </li>
              <li className="story-step">
                <h3>Run</h3>
                <p>
                  From then on it runs by itself. Steps that send or pay wait in your inbox for Approve. When a site
                  changes, Shadow repairs the step and saves it as v2; Roll back takes one click.
                </p>
                <More href="/how-it-works/">See every step</More>
              </li>
            </ol>
            <div className="story-stage">
              <Scaled width={600} fitHeight>
                <div className="stage">
                  <Pill state="saved" label="Saved: Invoices to Xero" />
                  <InvoiceTree />
                  <div className="story-cards">
                    <InboxCard
                      data="approval"
                      kind="Approval"
                      title="Approve: create the bill for Acme Ltd, 6,400 EUR"
                      buttons={["Approve", "Deny"]}
                    />
                    <InboxCard
                      data="repaired"
                      kind="Repaired"
                      tone="ok"
                      title={'Xero renamed "Save" to "Approve bill". Saved as v2.'}
                      buttons={["Looks right", "Roll back"]}
                    />
                  </div>
                </div>
              </Scaled>
              <p className="sr-only">
                A recording of filing an invoice becomes a workflow: for each new invoice, an AI step reads it, a branch
                adds the vendor if it is new, and creating the bill waits for approval. Later, a repair is saved as
                version 2.
              </p>
            </div>
          </div>
        </StoryScroll>
      </Band>

      <Band tone="light" label="Privacy">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Privacy</p>
            <h2 className="headline">Your Mac is the server.</h2>
            <p className="lead">
              There is no Shadow cloud. What it learns, remembers and runs stays on your Mac, and the model is called
              with <strong>your own key</strong>.
            </p>
          </div>
          <div className="tiles four">
            <article className="tile" data-reveal>
              <Icon name="mac" className="icon" />
              <h3 className="card-title">Stays on your Mac</h3>
              <p className="body">Workflows, the inbox and what Shadow remembers live in a folder on your Mac.</p>
            </article>
            <article className="tile" data-reveal>
              <Icon name="words" className="icon" />
              <h3 className="card-title">Words, not pictures</h3>
              <p className="body">
                Screen text is read on your Mac and private details are masked before anything leaves it.
              </p>
            </article>
            <article className="tile" data-reveal>
              <Icon name="hand" className="icon" />
              <h3 className="card-title">Nothing outward without you</h3>
              <p className="body">Sending, paying and deleting wait for your approval. A repair can't turn that off.</p>
            </article>
            <article className="tile" data-reveal>
              <Icon name="timer" className="icon" />
              <h3 className="card-title">Gone in a day</h3>
              <p className="body">A recording's raw files are deleted 24 hours after its workflow is saved.</p>
            </article>
          </div>
          <div style={{ marginTop: 40 }} data-reveal>
            <More href="/privacy/">Read how Shadow keeps it private</More>
          </div>
        </div>
      </Band>

      <Band tone="white" label="Use cases">
        <div className="wrap-wide">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Use cases</p>
            <h2 className="headline">The busywork of your week, handed over.</h2>
          </div>
          <div className="cases-strip">
            {CASES.map((item) => (
              <Link key={item.id} href={`/use-cases/#${item.id}`} className="case-link" data-reveal>
                <span className="chip">
                  <Icon name="calendar" />
                  {item.when}
                </span>
                <h3 className="card-title">{item.title}</h3>
                <p className="body">{item.once}</p>
                <span className="fine">In {item.where}</span>
              </Link>
            ))}
          </div>
          <div style={{ marginTop: 40 }} data-reveal>
            <More href="/use-cases/">See the use cases</More>
          </div>
        </div>
      </Band>

      <Band tone="light" label="The models">
        <div className="wrap">
          <div className="section-head center" data-reveal>
            <p className="eyebrow">Under the hood</p>
            <h2 className="headline">Built on NVIDIA Nemotron.</h2>
            <p className="lead">
              Shadow calls the models on Nebius Token Factory with your own key. Turn on Zero Data Retention for your
              account, and what Shadow sends isn't kept.
            </p>
          </div>
          <div className="tiles three">
            {MODELS.map((model) => (
              <article key={model.name} className="tile" data-reveal>
                <h3 className="card-title">{model.name}</h3>
                <p className="body">{model.role}</p>
              </article>
            ))}
          </div>
        </div>
      </Band>

      <ClosingCTA />
    </>
  );
}
