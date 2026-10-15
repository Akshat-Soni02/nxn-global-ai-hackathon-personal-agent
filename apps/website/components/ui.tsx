// The pieces every page is built from: a band (a full-width section with its tone), the two kinds of action (the
// blue pill for the one next thing, a text link with a chevron for the rest), the dot and its shadow, a page's
// opening, and the closing band that ends every page on the download.
import Link from "next/link";
import type { ReactNode } from "react";
import { LINKS } from "../lib/content";
import { Icon } from "./Icons";

export type Tone = "night" | "light" | "white";

export function Band({
  tone,
  id,
  label,
  className,
  children,
}: {
  tone: Tone;
  id?: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-tone={tone} id={id} aria-label={label} className={className ? `band ${className}` : "band"}>
      {children}
    </section>
  );
}

// A text link with a chevron: inside the site through Next's Link (so a base path is kept), outside as a plain link.
export function More({ href, children }: { href: string; children: ReactNode }) {
  const inner = (
    <>
      <span>{children}</span>
      <Icon name="chevron" />
    </>
  );
  if (href.startsWith("http")) {
    return (
      <a className="more" href={href} rel="noopener">
        {inner}
      </a>
    );
  }
  return (
    <Link className="more" href={href}>
      {inner}
    </Link>
  );
}

export function DownloadButton({ large = true, label = "Download for Mac" }: { large?: boolean; label?: string }) {
  return (
    <a className={large ? "button large" : "button"} href={LINKS.download}>
      {label}
    </a>
  );
}

// The dot and the shadow it casts: the mark, made large.
export function Orb() {
  return (
    <div className="orb" aria-hidden="true">
      <span className="glow" data-orb-glow />
      <span className="dot" />
    </div>
  );
}

// A page's opening: night, centred, the page's name as the eyebrow.
export function PageHero({ eyebrow, title, lead }: { eyebrow: string; title: ReactNode; lead: ReactNode }) {
  return (
    <Band tone="night" className="hero page-hero">
      <div className="wrap">
        <p className="eyebrow" data-reveal>
          {eyebrow}
        </p>
        <h1 className="hero-title" data-reveal>
          {title}
        </h1>
        <p className="lead" data-reveal>
          {lead}
        </p>
      </div>
    </Band>
  );
}

// Every page ends here: one promise, the download, the source.
export function ClosingCTA({ title = "Show it once.", lead }: { title?: string; lead?: ReactNode }) {
  return (
    <Band tone="night" className="closing" label="Get Shadow">
      <div className="wrap" data-reveal>
        <Orb />
        <h2 className="headline">{title}</h2>
        <p className="lead" style={{ margin: "20px auto 0" }}>
          {lead ?? "Then get on with your day. Shadow does it from here, on your Mac."}
        </p>
        <div className="actions">
          <DownloadButton />
          <More href={LINKS.repo}>Source on GitHub</More>
        </div>
        <p className="fine" style={{ marginTop: 22 }}>
          macOS 14 or later · Free and open source · Your own Nebius Token Factory key
        </p>
      </div>
    </Band>
  );
}
