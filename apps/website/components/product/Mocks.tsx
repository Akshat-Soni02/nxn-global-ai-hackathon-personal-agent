// Pieces of Shadow's own window, drawn in HTML the way the app draws them (apps/ui): the window and its sidebar, inbox
// cards, the floating Record pill, the goal box, a question card, the editor's panel, and a page with the step's
// target outlined. They are pictures of the product, so they are hidden from screen readers; each drawing on a page
// carries a sentence that says what it shows.
import type { ReactNode } from "react";
import { Mark } from "../Mark";

// The app's icons (apps/ui/src/main.tsx and Record.tsx): a 16 grid, a 1.5 stroke.
const APP_ICONS: Record<string, ReactNode> = {
  inbox: (
    <>
      <path d="M1.75 9.5 3.6 3.6a1 1 0 0 1 .95-.85h6.9a1 1 0 0 1 .95.85l1.85 5.9v2.75a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
      <path d="M1.75 9.5h3.5l1 1.75h3.5l1-1.75h3.5" />
    </>
  ),
  workflows: (
    <>
      <circle cx="4" cy="3.75" r="1.75" />
      <circle cx="4" cy="12.25" r="1.75" />
      <circle cx="12" cy="8" r="1.75" />
      <path d="M4 5.5v5M5.75 3.75c3 0 4.5 1 5.25 2.6M5.75 12.25c3 0 4.5-1 5.25-2.6" />
    </>
  ),
  runs: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.75 5.75v4.5L10.5 8z" />
    </>
  ),
  record: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
    </>
  ),
  settings: (
    <>
      <path d="M2 4.75h1.75M7.25 4.75H14M2 11.25h6.75M12.25 11.25H14" />
      <circle cx="5.5" cy="4.75" r="1.75" />
      <circle cx="10.5" cy="11.25" r="1.75" />
    </>
  ),
  screen: (
    <>
      <rect x="1.75" y="2.25" width="12.5" height="9" rx="1.5" />
      <path d="M5.5 14h5M8 11.25V14" />
    </>
  ),
  mic: (
    <>
      <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25" />
    </>
  ),
  picture: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <circle cx="5.5" cy="6.25" r="1.25" />
      <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75V8l2.25 1.5" />
    </>
  ),
};

function AppIcon({ name }: { name: keyof typeof APP_ICONS }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {APP_ICONS[name]}
    </svg>
  );
}

const SIDEBAR = [
  { id: "inbox", label: "Inbox" },
  { id: "workflows", label: "Workflows" },
  { id: "runs", label: "Runs" },
  { id: "record", label: "Record" },
  { id: "settings", label: "Settings" },
];

// The window: the traffic lights, the sidebar, and whatever screen is open.
export function Window({
  id,
  active = "inbox",
  badge,
  children,
}: {
  id: string;
  active?: string;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <div className="window" aria-hidden="true">
      <div className="window-bar">
        <i />
        <i />
        <i />
      </div>
      <div className="window-body">
        <div className="window-side">
          <div className="w-brand">
            <Mark id={`${id}-mark`} />
            Shadow
          </div>
          {SIDEBAR.map((item) => (
            <div key={item.id} className={item.id === active ? "w-nav active" : "w-nav"}>
              <AppIcon name={item.id} />
              {item.label}
              {item.id === "inbox" && badge ? <b>{badge}</b> : null}
            </div>
          ))}
        </div>
        <div className="window-main">{children}</div>
      </div>
    </div>
  );
}

// A card in the inbox: what kind it is, what it says, its answers.
export function InboxCard({
  kind,
  tone = "wait",
  title,
  buttons,
  free,
  data,
}: {
  kind: string;
  tone?: "wait" | "ok" | "ask";
  title: ReactNode;
  buttons: string[];
  free?: boolean;
  data?: string;
}) {
  return (
    <div className={tone === "wait" ? "ib" : `ib ${tone}`} data-mock={data}>
      <div className="ib-kind">{kind}</div>
      <div className="ib-title">{title}</div>
      <div className="ib-buttons">
        {buttons.map((label, i) => (
          <span
            key={label}
            className={i === 0 ? "primary" : undefined}
            data-mock={data && i === 0 ? `${data}-yes` : undefined}
          >
            {label}
          </span>
        ))}
      </div>
      {free ? <div className="ib-free">Or write your own answer</div> : null}
    </div>
  );
}

// The floating Record button on the Mac: idle, recording with its clock, or saved.
export function Pill({ state, label }: { state: "idle" | "rec" | "saved"; label: string }) {
  return (
    <div className="pill" data-state={state} data-mock="pill">
      <span className="rec-dot" />
      <span data-mock="pill-label">{label}</span>
    </div>
  );
}

// The goal box on the Record screen: the goal in a sentence, how often, what Shadow may use, Record.
export function GoalBox() {
  return (
    <div className="goal" aria-hidden="true">
      <p>Every morning, add the 5 newest YC jobs to my Ycomb jobs sheet, skipping companies already in it</p>
      <div className="goal-bar">
        <span className="goal-chip">
          <AppIcon name="clock" />
          Every day at 09:00
        </span>
        <span className="goal-icon on">
          <AppIcon name="screen" />
        </span>
        <span className="goal-icon on">
          <AppIcon name="mic" />
        </span>
        <span className="goal-icon">
          <AppIcon name="picture" />
        </span>
        <span className="goal-go">
          <i />
          Record
        </span>
      </div>
    </div>
  );
}

// The editor's panel for one step.
export function EditorPanel() {
  return (
    <div className="panel" aria-hidden="true">
      <div className="panel-head">
        <span className="k">if</span>
        <code>b1</code>
        <span className="x" />
      </div>
      <span className="lbl">What it is for</span>
      <div className="field">Which kind of role</div>
      <div className="check">
        <i />
        Wait for my approval
      </div>
      <span className="lbl">Condition · when the first side runs</span>
      <div className="field mono" style={{ fontSize: 11 }}>
        {"{ left: {{job.remote}}, op: equals, right: true }"}
      </div>
      <div className="panel-foot">
        <span>↑ Move up</span>
        <span>↓ Move down</span>
        <span className="danger">Remove</span>
      </div>
    </div>
  );
}

// A page in the automation window, with the next step's target outlined: the walk-through.
export function PageMock() {
  return (
    <div className="page-mock" aria-hidden="true">
      <div className="url">portal.example.com/invoices/new</div>
      <div className="content">
        <div className="bar" />
        <div className="bar short" />
        <div className="bar" />
        <span className="target">Submit invoice</span>
      </div>
    </div>
  );
}
