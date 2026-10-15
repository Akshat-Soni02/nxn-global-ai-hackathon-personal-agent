"use client";
// A drawing of the product made at one fixed width, fitted to its column: scaled down (never up past `max`) so a
// phone sees the same window, smaller, rather than a squashed one. The box takes the drawing's scaled height, so
// nothing below jumps; `fitHeight` also keeps it within the window's height (for the pinned story).
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

const NAV = 52;

export function Scaled({
  width,
  max = 1,
  fitHeight = false,
  children,
}: {
  width: number;
  max?: number;
  fitHeight?: boolean;
  children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const box = outer.current;
    const drawing = inner.current;
    if (!box || !drawing) return;
    const measure = () => {
      const height = drawing.offsetHeight;
      let scale = Math.min(max, box.clientWidth / width);
      if (fitHeight && window.matchMedia("(min-width: 834px)").matches && height > 0) {
        scale = Math.min(scale, (window.innerHeight - NAV - 120) / height);
      }
      setFit((f) => (Math.abs(f.scale - scale) < 0.002 && f.height === height ? f : { scale, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(drawing);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [width, max, fitHeight]);
  return (
    <div ref={outer} className="scaled" style={{ height: fit.height ? fit.height * fit.scale : undefined }}>
      <div
        ref={inner}
        className="scaled-inner"
        style={{
          width,
          transform: `translateX(-50%) scale(${fit.scale})`,
          position: fit.height ? "absolute" : "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}
