"use client";
// Questions that open in place, one at a time. Each question is a button that says whether it is open; a closed
// answer is inert (not read out, not focusable) while its height eases shut.
import { useId, useState } from "react";
import { Icon } from "./Icons";

export function FAQ({ items }: { items: readonly { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number>();
  const base = useId();
  return (
    <div className="faq">
      {items.map((item, i) => {
        const shown = open === i;
        return (
          <div key={item.q} className="faq-item">
            <h3 style={{ margin: 0 }}>
              <button
                id={`${base}-q${i}`}
                type="button"
                className="faq-q"
                aria-expanded={shown}
                aria-controls={`${base}-a${i}`}
                onClick={() => setOpen(shown ? undefined : i)}
              >
                {item.q}
                <Icon name="plus" className="faq-icon" />
              </button>
            </h3>
            <section
              id={`${base}-a${i}`}
              aria-labelledby={`${base}-q${i}`}
              className={shown ? "faq-a open" : "faq-a"}
              inert={!shown}
            >
              <div>
                <p>{item.a}</p>
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}
