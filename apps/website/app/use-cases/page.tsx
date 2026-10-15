// Use cases: tasks like the ones Shadow has been shown, each with what you do once, what Shadow does every time, and
// the workflow it holds. Then, plainly, what it is good at and what it doesn't do yet.
import type { Metadata } from "next";
import { Icon } from "../../components/Icons";
import { StepList } from "../../components/product/Tree";
import { Band, ClosingCTA, PageHero } from "../../components/ui";
import { CASES } from "../../lib/content";

export const metadata: Metadata = {
  title: "Use cases",
  description:
    "Weekly numbers into a sheet, Downloads filed, new jobs picked, a morning digest: tasks you show Shadow once and it does from then on.",
};

const GOOD = [
  "Tasks you repeat with the same steps and different values each time.",
  "Work that crosses Chrome, Mac apps and your files in one go.",
  "Reading and choosing: summarising, sorting, picking from a list.",
  "Anything with a clear “done”, so it can tell when it has finished.",
];
const NOT_YET = [
  "Starting when an email arrives. Today: on a schedule, when a file appears, or when you press Run.",
  "Adding a step by hand in the editor. Record the task again instead.",
  "Browsers other than Chrome.",
  "Steps only you can do, like a code sent by text. The run waits for you to do them.",
];

export default function UseCases() {
  return (
    <>
      <PageHero
        eyebrow="Use cases"
        title="The busywork of your week, handed over."
        lead="If you do it the same way every time, you can show it once. Here are tasks like the ones people hand to Shadow."
      />

      <Band tone="light" label="Examples">
        <div className="wrap-wide">
          {CASES.map((item) => (
            <article key={item.id} id={item.id} className="case" data-reveal style={{ scrollMarginTop: 80 }}>
              <div>
                <h2 className="title">{item.title}</h2>
                <div className="case-meta">
                  <span className="chip">
                    <Icon name="calendar" />
                    {item.when}
                  </span>
                  <span className="chip">
                    <Icon name="app" />
                    {item.where}
                  </span>
                </div>
                <dl className="compare">
                  <div>
                    <dt>You do it once</dt>
                    <dd>{item.once}</dd>
                  </div>
                  <div className="after">
                    <dt>Shadow, every time</dt>
                    <dd>{item.every}</dd>
                  </div>
                </dl>
              </div>
              <StepList steps={item.steps} />
            </article>
          ))}
        </div>
      </Band>

      <Band tone="white" label="Good at, and not yet">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Honestly</p>
            <h2 className="headline">What it's good at. What it isn't, yet.</h2>
          </div>
          <div className="tiles two">
            <div className="tile big" data-reveal>
              <h3 className="card-title" style={{ marginBottom: 20 }}>
                Good at
              </h3>
              <ul className="checks">
                {GOOD.map((line) => (
                  <li key={line}>
                    <Icon name="check" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="tile big" data-reveal>
              <h3 className="card-title" style={{ marginBottom: 20 }}>
                Not yet
              </h3>
              <ul className="checks checks-not">
                {NOT_YET.map((line) => (
                  <li key={line}>
                    <Icon name="dash" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Band>

      <ClosingCTA title="What will you show it first?" />
    </>
  );
}
