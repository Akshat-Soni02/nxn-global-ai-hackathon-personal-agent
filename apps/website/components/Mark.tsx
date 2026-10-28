// The mark (docs/design-ui.md, "The mark"): a white dot and the soft blue shadow it casts, on night blue. Drawn
// inline (no image request, no base-path to get right); `id` keeps its gradient and blur unique on a page. It always
// sits next to the word "Shadow", so it is decorative.
export function Mark({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#242642" />
          <stop offset="1" stopColor="#0d0d17" />
        </linearGradient>
        <filter id={`${id}-s`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <rect width="64" height="64" rx="14.3" fill={`url(#${id}-g)`} />
      <circle cx="36" cy="36" r="12" fill="#3a5bd9" opacity="0.9" filter={`url(#${id}-s)`} />
      <circle cx="30" cy="30" r="12" fill="#fafaff" />
      <circle cx="30" cy="30" r="4.1" fill="#ef4444" />
      {/* The night square is ~1.2:1 against a night bar, so over night the bar gives it a rim (--mark-rim, 5.4:1);
          over light it is transparent. A 1 px non-scaling line, inset so the svg edge doesn't clip half of it. */}
      <rect
        className="mark-rim"
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="12.8"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
