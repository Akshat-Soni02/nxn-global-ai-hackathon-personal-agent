// One icon family for the whole site: a 1.5 stroke in the text's colour, rounded ends, drawn on a 24 grid (the
// window's own icons, inside the product drawings, keep the app's 16 grid). Decorative unless given a label.
import type { ReactNode } from "react";

const PATHS = {
  chevron: <path d="m9 5 7 7-7 7" />,
  menu: <path d="M4 9h16M4 15h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  dash: <path d="M6 12h12" />,
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />,
  watch: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  repair: (
    <>
      <path d="M14.5 6.5a4 4 0 0 0-5.3 5.2L4 17l3 3 5.3-5.2a4 4 0 0 0 5.2-5.3l-2.6 2.6-2.6-.4-.4-2.6 2.6-2.6Z" />
    </>
  ),
  mac: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  words: (
    <>
      <path d="M4 7V5h16v2M12 5v14M9 19h6" />
    </>
  ),
  hand: (
    <>
      <path d="M12 3.5 4.5 6.5v5c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9v-5L12 3.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  timer: (
    <>
      <path d="M5 7h14M9.5 7V5h5v2M7 7l1 12.5h8L17 7" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v3M15.5 3.5v3" />
    </>
  ),
  app: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9h17" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="14" r="4" />
      <path d="m11 11 8-8m-3 3 2.5 2.5M14 8l2 2" />
    </>
  ),
  chrome: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 8.8h8M9.2 13.6 5.2 6.7M14.8 13.6l-4 6.9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 4.5 6.5v5c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9v-5L12 3.5Z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}
