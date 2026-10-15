"use client";
// The Overview's story, played by the scroll: the section holds still (pinned) while one timeline runs, tied to the
// scroll position so it moves exactly as fast as the reader and can be reversed at any frame.
//   Record      the pill appears, already recording, its clock running; then it shows the saved workflow
//   Understand  the workflow builds, step by step: the start, the loop, the AI step, the fork, the approval step
//   Run         an approval arrives and is approved; later a repair lands as v2
// The page's own HTML is the finished state, so a phone, a reader with Reduce Motion, or no scripts at all see the
// whole story at once. Only wide screens with motion allowed get the pinned version (.story-live).
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { type ReactNode, useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const NAV = 52;

export function StoryScroll({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add("(min-width: 834px) and (prefers-reduced-motion: no-preference)", () => {
        const q = gsap.utils.selector(root);
        const steps = q(".story-step");
        const pill = q('[data-mock="pill"]')[0];
        const label = q('[data-mock="pill-label"]')[0];
        const built = q("[data-build]");
        const approval = q('[data-mock="approval"]')[0];
        const approve = q('[data-mock="approval-yes"]')[0];
        const repaired = q('[data-mock="repaired"]')[0];
        if (!pill || !label || !approval || !approve || !repaired) return;
        root.classList.add("story-live");

        const clock = { seconds: 0 };
        const tick = () => {
          label.textContent = `Stop · 0:${String(Math.round(clock.seconds)).padStart(2, "0")}`;
        };
        const tl = gsap.timeline({
          defaults: { ease: "power2.out", duration: 0.5 },
          scrollTrigger: {
            trigger: root,
            start: `top ${NAV}px`,
            end: "+=260%",
            pin: true,
            scrub: 0.8,
            anticipatePin: 1,
          },
        });

        // Where it starts: nothing recorded yet, and no pill (it shows only for a recording, as on the Mac).
        tl.set(steps, { opacity: 0.32 }, 0)
          .set(steps[0] ?? [], { opacity: 1 }, 0)
          .set(pill, { attr: { "data-state": "rec" }, autoAlpha: 0, scale: 0.9 }, 0)
          .set(label, { textContent: "Stop · 0:00" }, 0)
          .set(built, { autoAlpha: 0, y: 14 }, 0)
          .set([approval, repaired], { autoAlpha: 0, y: 16 }, 0);

        // Record: the pill appears, already recording; the clock runs to 0:42.
        tl.to(pill, { autoAlpha: 1, scale: 1, duration: 0.4 }, 0.2)
          .add(tick)
          .to(clock, { seconds: 42, duration: 1.8, ease: "none", onUpdate: tick });

        // Understand: stopped and saved; the workflow builds.
        tl.set(pill, { attr: { "data-state": "saved" } })
          .set(label, { textContent: "Saved: Invoices to Xero" })
          .to(steps[0] ?? [], { opacity: 0.32 }, "<")
          .to(steps[1] ?? [], { opacity: 1 }, "<")
          .to(built, { autoAlpha: 1, y: 0, stagger: 0.32 }, "+=0.1");

        // Run: an approval arrives and is approved; a repair lands as v2.
        tl.to(steps[1] ?? [], { opacity: 0.32 }, "+=0.3")
          .to(steps[2] ?? [], { opacity: 1 }, "<")
          .to(approval, { autoAlpha: 1, y: 0 }, "<")
          .to(approve, { scale: 0.9, duration: 0.15 }, "+=0.5")
          .to(approve, { scale: 1, duration: 0.25 })
          .to(approval, { autoAlpha: 0, y: -12 }, "+=0.15")
          .to(repaired, { autoAlpha: 1, y: 0 }, "+=0.2")
          .to({}, { duration: 0.6 });

        return () => root.classList.remove("story-live");
      });
    },
    { scope },
  );
  return (
    <div ref={scope} className="story-scope">
      {children}
    </div>
  );
}
