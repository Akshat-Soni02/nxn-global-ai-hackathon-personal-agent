"use client";
// The glow on the Overview's window: an iridescent rim (cyan, magenta, amber, violet sweeping round the frame) and a
// blurred bloom of the same light behind it, after Apple Intelligence. It fades in when the page loads, then breathes at
// rest. At the first scroll, wheel, touch or key it dissolves into the page: the bloom fades from wherever its breath
// was (a spring from the live value, so it can't jump) and the rim drops to a faint line. Colour is the one place the
// site leaves its single accent, and only here. With Reduce Motion it is a still rim; the breath is opacity only, one
// cycle every four seconds, so nothing scales or slides.
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { type ReactNode, useRef } from "react";
import { spring } from "./spring";

gsap.registerPlugin(useGSAP);

export function AiRim({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const root = scope.current;
      const bloom = root?.querySelector<HTMLElement>(".ai-bloom");
      const ring = root?.querySelector<HTMLElement>(".ai-ring");
      if (!root || !bloom || !ring) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        let settled = false;
        let visible = true;
        let breathe: gsap.core.Tween | undefined;

        gsap.to(ring, { opacity: 1, duration: 0.9, ease: "power2.out" });
        gsap.to(bloom, {
          opacity: 0.45,
          duration: 1.2,
          ease: "power2.out",
          onComplete: () => {
            if (settled) return;
            breathe = gsap.to(bloom, { opacity: 0.7, duration: 2, ease: "sine.inOut", yoyo: true, repeat: -1 });
            breathe.paused(!visible);
          },
        });

        const events = ["scroll", "wheel", "pointerdown", "keydown"] as const;
        const settle = () => {
          if (settled) return;
          settled = true;
          for (const e of events) window.removeEventListener(e, settle);
          breathe?.kill();
          const s = spring(0.8);
          gsap.to(bloom, { opacity: 0, scale: 1.06, duration: s.duration, ease: s.ease, overwrite: true });
          gsap.to(ring, {
            opacity: 0.2,
            duration: s.duration,
            ease: s.ease,
            overwrite: true,
            onComplete: () => root.classList.add("settled"),
          });
        };
        for (const e of events) window.addEventListener(e, settle, { passive: true });

        // Off screen, the sweep and the breath stop: nothing is spent on what nobody sees.
        const watch = new IntersectionObserver(([entry]) => {
          visible = !!entry?.isIntersecting;
          root.classList.toggle("off", !visible);
          breathe?.paused(!visible);
        });
        watch.observe(root);

        return () => {
          watch.disconnect();
          for (const e of events) window.removeEventListener(e, settle);
          gsap.killTweensOf([bloom, ring]);
        };
      });
    },
    { scope },
  );
  return (
    <div ref={scope} className="ai-rim">
      {children}
      <div className="ai-bloom" aria-hidden="true">
        <span className="glow-ring">
          <i className="sweep" />
        </span>
      </div>
      <div className="ai-ring" aria-hidden="true">
        <span className="glow-ring">
          <i className="sweep" />
        </span>
      </div>
    </div>
  );
}
