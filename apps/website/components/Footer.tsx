// Apple's footer: the fine print first, then the site in four short columns, then one line.
import Link from "next/link";
import { LINKS } from "../lib/content";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/", label: "Overview" },
      { href: "/how-it-works/", label: "How it works" },
      { href: "/use-cases/", label: "Use cases" },
      { href: "/download/", label: "Download" },
    ],
  },
  {
    title: "Privacy",
    links: [
      { href: "/privacy/", label: "Private by design" },
      { href: "/privacy/#stays", label: "What stays on your Mac" },
      { href: "/privacy/#leaves", label: "What leaves it" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/download/#setup", label: "Setting up" },
      { href: "/download/#faq", label: "Questions" },
      { href: LINKS.product, label: "The first-time guide" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: LINKS.repo, label: "Source on GitHub" },
      { href: LINKS.docs, label: "Design notes" },
      { href: LINKS.hackathon, label: "The hackathon" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-note">
          <p>
            Shadow was built for the Nebius × NVIDIA Global AI Hackathon, Personal AI track. It runs NVIDIA Nemotron
            models on Nebius Token Factory, with your own key.
          </p>
          <p>Shadow is signed by its makers, not by Apple: the first time, right-click the app and choose Open.</p>
        </div>
        <nav className="footer-cols" aria-label="Footer">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.href.startsWith("http") ? (
                      <a href={link.href} rel="noopener">
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href}>{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="footer-bottom">
          <span>Shadow · Show it once.</span>
          <span>
            Open source under the{" "}
            <a href={`${LINKS.repo}/blob/main/LICENSE`} rel="noopener" style={{ textDecoration: "underline" }}>
              MIT licence
            </a>
            .
          </span>
        </div>
      </div>
    </footer>
  );
}
