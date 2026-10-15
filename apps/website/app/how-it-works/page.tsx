// How it works: the eight moments, from saying what the task is for to a repair rolled back, each beside the part of
// the app where it happens.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EditorPanel, GoalBox, InboxCard, PageMock, Pill } from "../../components/product/Mocks";
import { Scaled } from "../../components/product/Scaled";
import { JobsTree } from "../../components/product/Tree";
import { Band, ClosingCTA, PageHero } from "../../components/ui";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Say what the task is for, do it once, and Shadow builds a workflow you can read, change, walk through and run. When a site changes, it repairs itself.",
};

function Moment({
  n,
  title,
  flip,
  visual,
  label,
  children,
}: {
  n: number;
  title: string;
  flip?: boolean;
  visual: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <article className={flip ? "feature flip" : "feature"}>
      <div className="feature-copy" data-reveal>
        <span className="step-no" aria-hidden="true">
          {n}
        </span>
        <h2 className="title">{title}</h2>
        <p className="body">{children}</p>
      </div>
      <div className="feature-visual" data-reveal>
        {visual}
        <p className="sr-only">{label}</p>
      </div>
    </article>
  );
}

export default function HowItWorks() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="From one recording to a workflow that runs."
        lead="Shadow learns the task the way a colleague would: by watching once, asking only what it can't tell, and checking with you before anything that matters."
      />

      <Band tone="white" label="Learn">
        <div className="wrap-wide">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Learn</p>
            <h2 className="headline">You show it. It works out the rest.</h2>
          </div>
          <Moment
            n={1}
            title="Say what it's for."
            label="The goal box: the goal in a sentence, how often it runs, and switches for the screen, the voice and pictures."
            visual={
              <div className="still">
                <GoalBox />
              </div>
            }
          >
            One box: what is done when the task is done, and how often it should run. Choose what Shadow may use: the
            words on screen, your voice, pictures. Anything else it needs, it asks after you stop.
          </Moment>
          <Moment
            n={2}
            flip
            title="Do it once, your way."
            label="The red recording button, 42 seconds in, and a sentence the user said while recording."
            visual={
              <div className="still center-items">
                <Pill state="rec" label="Stop · 0:42" />
                <div className="quote">
                  “Always the newest one.”
                  <small>What you said, turned into text on your Mac</small>
                </div>
              </div>
            }
          >
            Press Record and do the task in Chrome, a Mac app or Finder. Talk if you like: “always the newest one”
            becomes part of the workflow. Your voice is turned into text on your Mac, and the audio never leaves it.
          </Moment>
          <Moment
            n={3}
            title="It works out the steps."
            label="A workflow drawn as a tree: open the jobs page, an AI step picks up to five jobs, then for each job a three-way branch, and saving the row waits for approval."
            visual={
              <div className="still">
                <Scaled width={620}>
                  <JobsTree />
                </Scaled>
              </div>
            }
          >
            NVIDIA Nemotron 3 Super reads the recording with what you said and the masked screen words, and builds a
            workflow you can read: values that change become inputs, repeated work a loop, “only if” a branch, reading
            and choosing an AI step.
          </Moment>
          <Moment
            n={4}
            flip
            title="It asks only what it can't tell."
            label="A question card with two answers and a box to write your own."
            visual={
              <div className="still">
                <InboxCard
                  kind="Question"
                  tone="ask"
                  title="For a new-grad job, what goes in the Kind column?"
                  buttons={["Mark it New grad", "Skip it"]}
                  free
                />
              </div>
            }
          >
            A question appears beside the step it is about. Pick an answer or write your own. Answers that last are
            remembered, so it doesn't ask twice.
          </Moment>
        </div>
      </Band>

      <Band tone="light" label="Check">
        <div className="wrap-wide">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Check</p>
            <h2 className="headline">Nothing runs that you haven't seen.</h2>
          </div>
          <Moment
            n={5}
            title="Change anything."
            label="The editor's panel for one step: what it is for, wait for my approval, its condition, move and remove."
            visual={
              <div className="still">
                <EditorPanel />
              </div>
            }
          >
            The workflow is a tree you can read. Click a step to change what it is for, its values, or whether it waits
            for your approval; move it or remove it. Save it as the next version when you're happy. Until then, the old
            one keeps running.
          </Moment>
          <Moment
            n={6}
            flip
            title="Walk through it, a step at a time."
            label="A web page with the Submit invoice button outlined, and a card offering Do it, Skip and Stop."
            visual={
              <div className="still center-items">
                <PageMock />
                <InboxCard
                  kind="Walk through"
                  tone="ask"
                  title="Next: click “Submit invoice”"
                  buttons={["Do it", "Skip", "Stop"]}
                />
              </div>
            }
          >
            Before each step runs, its target is outlined on the page or in the app. You choose Next, Do it, Skip or
            Stop, so you see exactly what it will do before it does it.
          </Moment>
        </div>
      </Band>

      <Band tone="white" label="Run">
        <div className="wrap-wide">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Run</p>
            <h2 className="headline">Then it keeps going. Even when sites change.</h2>
          </div>
          <Moment
            n={7}
            title="Let it run."
            label="An approval card waiting in the inbox: Approve or Deny."
            visual={
              <div className="still">
                <InboxCard
                  kind="Approval"
                  title="Approve: write this week's numbers in the KPI sheet"
                  buttons={["Approve", "Deny"]}
                />
              </div>
            }
          >
            Run it now, every day at nine, or when a file appears in a folder. Steps that send, pay or delete wait in
            your inbox, with a notification. A workflow that fails three times in a row pauses itself and tells you why.
          </Moment>
          <Moment
            n={8}
            flip
            title="It fixes itself, with proof."
            label="A repair card: the portal renamed Submit to Submit invoice, saved as version 2, with Looks right and Roll back."
            visual={
              <div className="still">
                <InboxCard
                  kind="Repaired"
                  tone="ok"
                  title={'The portal renamed "Submit" to "Submit invoice". Saved as v2.'}
                  buttons={["Looks right", "Roll back"]}
                />
              </div>
            }
          >
            When a step fails, Shadow first works out why. A site that is down is tried again later; a login only you
            can do waits for you; a changed page is repaired. A fix is kept only when it worked, saved as a new version,
            and one click rolls it back.
          </Moment>
        </div>
      </Band>

      <ClosingCTA lead="Record your first task in a few minutes. Shadow takes it from there." />
    </>
  );
}
