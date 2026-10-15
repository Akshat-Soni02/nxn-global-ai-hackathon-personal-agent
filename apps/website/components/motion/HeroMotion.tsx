"use client";
// The Overview's opening. The headline rises line by line; the dot's blue shadow slides out from under it to where it
// rests (the mark, assembling); then, as the page scrolls, the window rises and settles flat into place, tied to the
// scroll (scrubbed, so it can be stopped and reversed at any point). With Reduce Motion, all of it is simply there.
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { type ReactNode, useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function HeroMotion({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
        intro.fromTo(
          "[data-orb-glow]",
          { x: 0, y: 0, opacity: 0 },
          { x: 14, y: 14, opacity: 0.9, duration: 1.4, ease: "power2.out" },
          0.15,
        );
        intro.to(".hero-line", { opacity: 1, y: 0, duration: 1.1, stagger: 0.12 }, 0.1);
        intro.to("[data-hero-fade]", { opacity: 1, y: 0, duration: 1, stagger: 0.1 }, 0.4);
        gsap.fromTo(
          "[data-hero-window]",
          { y: 70, scale: 0.92, rotationX: 10, transformPerspective: 1400 },
          {
            y: 0,
            scale: 1,
            rotationX: 0,
            ease: "none",
            scrollTrigger: { trigger: "[data-hero-window]", start: "top 98%", end: "top 30%", scrub: 0.8 },
          },
        );
      });
    },
    { scope },
  );
  return <div ref={scope}>{children}</div>;
}
