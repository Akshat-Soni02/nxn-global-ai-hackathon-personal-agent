"use client";
// The page's reveals: anything marked data-reveal rises 24 px and fades in as it scrolls into view, once, in small
// staggered groups. It is the <main> of every page, so it starts again on each page and its triggers end with it.
// Content is hidden before this runs only when motion is allowed and the page's scripts are on (html.js, set before
// first paint in layout.tsx); html.gsap tells that script the reveals did start, so nothing can stay hidden.
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { usePathname } from "next/navigation";
import { type ReactNode, useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function MotionRoot({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useGSAP(
    () => {
      document.documentElement.classList.add("gsap");
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const items = gsap.utils.toArray<HTMLElement>("[data-reveal]", scope.current);
        ScrollTrigger.batch(items, {
          start: "top 92%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.07, overwrite: true }),
        });
      });
      // Fonts and the drawings' sizes settle after first paint: measure the triggers again then.
      document.fonts?.ready.then(() => ScrollTrigger.refresh());
      return () => mm.revert();
    },
    { scope, dependencies: [pathname], revertOnUpdate: true },
  );
  return (
    <main id="main" ref={scope}>
      {children}
    </main>
  );
}
