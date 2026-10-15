"use client";
// The bar at the top of every page: the mark and the name, the four pages, and Download as the one action. It is a
// translucent material that takes the tone of the band under it (dark over a night band, light elsewhere). On a
// narrow screen the pages fold into a sheet that drops from the bar: Esc or the button closes it, Tab stays inside.
// The sheet sits beside the bar, not in it: the bar's backdrop-filter would make it the sheet's containing block.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LINKS, NAV } from "../lib/content";
import { Icon } from "./Icons";
import { Mark } from "./Mark";

const same = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

export function Nav() {
  const pathname = usePathname();
  const [overNight, setOverNight] = useState(true);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(pathname);
  const sheet = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // A new page closes the sheet.
  if (shown !== pathname) {
    setShown(pathname);
    setOpen(false);
  }

  // The tone of the band just under the bar, looked at once per frame while the page scrolls.
  useEffect(() => {
    let frame = 0;
    const look = () => {
      frame = 0;
      const bar = document.querySelector<HTMLElement>(".nav");
      const y = (bar?.getBoundingClientRect().bottom ?? 52) + 1;
      let tone: string | undefined;
      for (const band of document.querySelectorAll<HTMLElement>("main [data-tone]")) {
        const box = band.getBoundingClientRect();
        if (box.top <= y && box.bottom > y) tone = band.dataset.tone;
      }
      setOverNight(tone === "night");
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(look);
    };
    look();
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
    };
  }, []);

  // While the sheet is open: the page under it doesn't scroll, focus goes to its first link and stays inside.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    sheet.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !sheet.current || !button.current) return;
      const items = [button.current, ...sheet.current.querySelectorAll<HTMLElement>("a")];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = before;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const tone = overNight ? " over-night" : "";
  return (
    <>
      <header className={`nav${tone}`}>
        <nav className="wrap-wide nav-inner" aria-label="Main">
          <Link href="/" className="brand">
            <Mark id="nav-mark" />
            Shadow
          </Link>
          <div className="nav-links">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} aria-current={same(pathname, item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </div>
          <a className="button nav-cta" href={LINKS.download}>
            Download
          </a>
          <button
            ref={button}
            type="button"
            className="menu-button"
            aria-expanded={open}
            aria-controls="menu"
            aria-label={open ? "Close the menu" : "Open the menu"}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </nav>
      </header>
      {open ? (
        <div id="menu" ref={sheet} className={`sheet${tone}`} role="dialog" aria-modal="true" aria-label="Menu">
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={same(pathname, item.href) ? "page" : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/download/" aria-current={same(pathname, "/download/") ? "page" : undefined}>
                Download
              </Link>
            </li>
          </ul>
          <a className="button large" href={LINKS.download}>
            Download for Mac
          </a>
        </div>
      ) : null}
    </>
  );
}
