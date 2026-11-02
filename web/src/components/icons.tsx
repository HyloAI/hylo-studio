// Stroke icons drawn for this console (24px grid, currentColor).
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icon = {
  console: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4M7 12l3-3 2 2 4-4" /></svg>,
  station: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 20h14M8 20v-3h8v3M12 17V9" /><circle cx="12" cy="6.5" r="2.5" /><path d="m12 9 5 3" /></svg>,
  live: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>,
  runs: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" /></svg>,
  compare: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3v18" /><rect x="3" y="7" width="6" height="10" rx="1" /><rect x="15" y="5" width="6" height="14" rx="1" /></svg>,
  loop: () => <svg viewBox="0 0 24 24" {...P}><path d="M20 8a8 8 0 0 0-14.5-2M4 16a8 8 0 0 0 14.5 2" /><path d="M5.5 2.5v3.5H9M18.5 21.5V18H15" /></svg>,
  learn: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></svg>,
  // a flask with a code bracket inside: programs developed by experiment
  research: () => <svg viewBox="0 0 24 24" {...P}><path d="M9 3h6M10 3v5.5L4.8 18a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L14 8.5V3" /><path d="m10.5 13-1.5 1.75 1.5 1.75M13.5 13l1.5 1.75-1.5 1.75" /></svg>,
  world: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></svg>,
  jobs: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="m7 10 3 2-3 2M12 15h5" /></svg>,
  play: () => <svg viewBox="0 0 24 24" {...P}><path d="M7 5v14l11-7L7 5Z" fill="currentColor" /></svg>,
  pause: () => <svg viewBox="0 0 24 24" {...P}><path d="M8 5v14M16 5v14" strokeWidth={2.6} /></svg>,
  back: () => <svg viewBox="0 0 24 24" {...P}><path d="M17 6 9 12l8 6V6ZM7 6v12" /></svg>,
  fwd: () => <svg viewBox="0 0 24 24" {...P}><path d="m7 6 8 6-8 6V6ZM17 6v12" /></svg>,
  stop: () => <svg viewBox="0 0 24 24" {...P}><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" /></svg>,
  arrow: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  // brand mark: a parallel gripper seen from above
  mark: () => (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
      <rect x="0.5" y="0.5" width="27" height="27" rx="5" fill="var(--signal)" />
      <path d="M9 7v8.5a5 5 0 0 0 10 0V7" stroke="var(--signal-ink)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M14 20.5V23" stroke="var(--signal-ink)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="14" cy="13" r="1.8" fill="var(--signal-ink)" />
    </svg>
  ),
};
