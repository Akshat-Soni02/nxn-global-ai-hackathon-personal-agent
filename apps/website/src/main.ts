// The page's motion (docs/design-ui.md, "The website"): GSAP on a static prototype of the product. The hero plays a
// short story on a loop (the pill starts recording, the steps appear, the approval is given, a repair lands), and
// the sections reveal as they scroll in. With "Reduce motion" on, everything is shown at once.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = "power3.out";

function hero() {
  const pill = document.getElementById("pill");
  const label = pill?.querySelector(".label");
  const steps = Array.from(document.querySelectorAll("#tree li"));
  const approve = document.getElementById("approve");
  const cardApprove = document.getElementById("card-approve");
  const cardRepaired = document.getElementById("card-repaired");
  if (!pill || !label || !approve || !cardApprove || !cardRepaired || reduced) return;

  const clock = { seconds: 0 };
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6, defaults: { ease } });
  // Start: nothing in the tree yet, the repair not landed, the approval waiting.
  tl.set(steps, { autoAlpha: 0, x: -8 });
  tl.set(cardRepaired, { autoAlpha: 0, y: 10 });
  tl.set(cardApprove, { autoAlpha: 1, y: 0 });
  tl.set(clock, { seconds: 0 });
  // The pill is pressed and starts recording; the clock runs.
  tl.to(pill, { scale: 0.96, duration: 0.12 }).to(pill, { scale: 1, duration: 0.3 });
  tl.add(() => {
    pill.classList.add("rec");
  });
  tl.to(clock, {
    seconds: 42,
    duration: 2.6,
    ease: "none",
    onUpdate: () => {
      label.textContent = `Stop · 0:${String(Math.floor(clock.seconds)).padStart(2, "0")}`;
    },
  });
  // Stop: the steps appear one by one.
  tl.add(() => {
    pill.classList.remove("rec");
    label.textContent = "Saved: Weekly KPI email";
  });
  tl.to(steps, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.18 }, "+=0.3");
  // The approval is given.
  tl.to(approve, { scale: 0.95, duration: 0.12 }, "+=0.8").to(approve, { scale: 1, duration: 0.3 });
  tl.to(cardApprove, { autoAlpha: 0, y: -8, duration: 0.4 }, "+=0.2");
  // A repair lands as v2.
  tl.to(cardRepaired, { autoAlpha: 1, y: 0, duration: 0.5 }, "+=0.4");
  tl.add(() => {
    label.textContent = "Record";
  }, "+=1.4");
}

function reveals() {
  if (reduced) return;
  for (const item of document.querySelectorAll("[data-reveal]")) {
    gsap.from(item, {
      autoAlpha: 0,
      y: 24,
      duration: 0.7,
      ease,
      scrollTrigger: { trigger: item, start: "top 85%", once: true },
    });
  }
  const tree = document.querySelector("[data-tree]");
  if (tree) {
    gsap.from(tree.children, {
      autoAlpha: 0,
      x: -10,
      duration: 0.5,
      stagger: 0.12,
      ease,
      scrollTrigger: { trigger: tree, start: "top 80%", once: true },
    });
  }
  // The window drifts up a little as the page scrolls, the pill a little more: depth.
  const drift = (target: string, y: number) =>
    gsap.to(target, {
      y,
      ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true },
    });
  drift("#window", -40);
  drift("#pill", -80);
}

hero();
reveals();
