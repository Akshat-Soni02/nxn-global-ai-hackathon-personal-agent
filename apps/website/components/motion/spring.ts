// A spring in Apple's two numbers (docs: apple-design, "Behavior over animation"): `damping` 1 is critically damped, no
// overshoot; below 1 it overshoots; `response` is how fast it gets there, in seconds. GSAP wants an ease and a
// duration, so this returns both: the ease is the spring's own curve, the duration is when it has settled to within a
// thousandth. No library: it is the closed form, so the same call works for any element and any distance.
export function spring(response: number, damping = 1) {
  const w = (2 * Math.PI) / response;
  const wd = w * Math.sqrt(1 - Math.min(damping, 1) ** 2);
  const x = (t: number) =>
    damping >= 1
      ? 1 - (1 + w * t) * Math.exp(-w * t)
      : 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
  // The last moment it is still more than a thousandth away (a bouncy spring can cross 1 and come back).
  let last = 0;
  for (let t = 0; t < 5; t += 0.01) if (Math.abs(1 - x(t)) > 0.001) last = t;
  const duration = last + 0.01;
  const end = x(duration);
  return { duration, ease: (p: number) => x(p * duration) / end };
}
