// Camera viewport, step timeline and action traces shared by the live sandbox and the replay.
import { ReactNode, useMemo } from "react";

export const pad = (n: number, w = 4) => String(Math.max(0, Math.round(n))).padStart(w, "0");

export function Viewport({ src, cam, step, maxSteps, live, empty }: {
  src?: string | null; cam: string; step?: number; maxSteps?: number; live?: boolean; empty?: ReactNode;
}) {
  return (
    <div className="vp">
      {src ? <img src={src} alt={`${cam} camera`} /> : <div className="empty">{empty ?? "no frame"}</div>}
      <div className="reg" />
      <div className="hud t"><span>{cam}</span>{step !== undefined && <span className="num">step {pad(step)}{maxSteps ? ` / ${pad(maxSteps)}` : ""}</span>}</div>
      {live && <div className="hud b"><span className="rec">● rec</span><span>live</span></div>}
    </div>
  );
}

export function Timeline({ max, done, cursor, chunks = [], safety = [], onSeek }: {
  max: number; done?: number; cursor?: number; chunks?: number[]; safety?: { step: number; title?: string }[]; onSeek?: (step: number) => void;
}) {
  const x = (s: number) => `${(Math.min(s, max) / Math.max(1, max)) * 100}%`;
  return (
    <div>
      <div className="tl" onClick={(e) => {
        if (!onSeek) return;
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.round(((e.clientX - r.left) / r.width) * max));
      }}>
        <div className="rail2" />
        {done !== undefined && <div className="done" style={{ width: x(done) }} />}
        {chunks.map((c, i) => <div key={i} className="tick" style={{ left: x(c) }} />)}
        {safety.map((s, i) => <div key={i} className="saf" style={{ left: x(s.step) }} title={s.title} />)}
        {cursor !== undefined && <div className="head2" style={{ left: x(cursor) }} />}
      </div>
      <div className="scale">{[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>{Math.round(f * max)}</span>)}</div>
    </div>
  );
}

const AX = [
  { name: "x", c: "var(--ax-x)" }, { name: "y", c: "var(--ax-y)" }, { name: "z", c: "var(--ax-z)" },
];

function Lane({ name, keys, series, xMax, height, yRange, cursor, chunks, area, onSeek }: {
  name: string; keys?: ReactNode; series: { c: string; pts: [number, number][]; dash?: boolean }[]; xMax: number; height: number;
  yRange?: [number, number]; cursor?: number; chunks?: number[]; area?: boolean; onSeek?: (s: number) => void;
}) {
  const W = 1000, H = height;
  const [y0, y1] = useMemo(() => {
    if (yRange) return yRange;
    let m = 0;
    for (const s of series) for (const [, y] of s.pts) m = Math.max(m, Math.abs(y));
    m = m || 1;
    return [-m * 1.1, m * 1.1] as [number, number];
  }, [series, yRange]);
  const X = (v: number) => (v / Math.max(1, xMax)) * W;
  const Y = (v: number) => 3 + (1 - (v - y0) / (y1 - y0)) * (H - 6);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="lane-name"><span>{name}</span>{keys}</div>
      <svg className="trace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H, cursor: onSeek ? "pointer" : undefined }}
        onClick={(e) => { if (!onSeek) return; const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); onSeek(Math.round(((e.clientX - r.left) / r.width) * xMax)); }}>
        <rect x="0" y="0" width={W} height={H} fill="var(--inset)" />
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={f * H} y2={f * H} stroke="var(--grid)" vectorEffect="non-scaling-stroke" />)}
        {(chunks || []).map((c, i) => <line key={i} x1={X(c)} x2={X(c)} y1="0" y2={H} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />)}
        {y0 < 0 && y1 > 0 && <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />}
        {area && series[0] && series[0].pts.length > 1 && (
          <path d={`M${X(series[0].pts[0][0])},${Y(y0)} ` + series[0].pts.map(([a, b]) => `L${X(a)},${Y(b)}`).join(" ") + ` L${X(series[0].pts[series[0].pts.length - 1][0])},${Y(y0)} Z`}
            fill={series[0].c} opacity={0.16} />
        )}
        {series.map((s, i) => (
          <polyline key={i} fill="none" stroke={s.c} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray={s.dash ? "4 3" : undefined}
            points={s.pts.map(([a, b]) => `${X(a)},${Y(b)}`).join(" ")} />
        ))}
        {cursor !== undefined && <line x1={X(cursor)} x2={X(cursor)} y1="0" y2={H} stroke="var(--signal)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

/** Executed end-effector deltas: translation and rotation lanes (RViz axis colors), gripper lane, optional judge lane. */
const JOINT_COLORS = ["var(--ax-x)", "var(--ax-y)", "var(--ax-z)", "var(--signal)", "var(--trace-a)", "var(--ok)", "var(--hazard)"];

export function Traces({ actions, xMax, cursor, chunks, onSeek, judge, compact, joints }: {
  actions: number[][]; xMax: number; cursor?: number; chunks?: number[]; onSeek?: (s: number) => void;
  judge?: { name: string; pts: [number, number][] } | null; compact?: boolean; joints?: boolean;
}) {
  const d = actions[0]?.length || 0;
  const col = (k: number) => actions.map((a, i) => [i, a[k]] as [number, number]);
  const h = compact ? 64 : 84;
  if (!d) return <div className="empty-state">no actions recorded yet</div>;
  const k = (c: string, n: string, dash?: boolean) => <span className="key" key={n}><i className={dash ? "dash" : ""} style={{ ["--c" as any]: c }} />{n}</span>;
  if (joints) {                                        // joint-space control: one lane of joint targets + gripper
    const n = Math.max(1, d - 1);
    return (
      <div className="stack" style={{ gap: 12 }}>
        <Lane name="joint targets" keys={Array.from({ length: n }, (_, i) => k(JOINT_COLORS[i % JOINT_COLORS.length], `j${i + 1}`))}
          series={Array.from({ length: n }, (_, i) => ({ c: JOINT_COLORS[i % JOINT_COLORS.length], pts: col(i) }))}
          xMax={xMax} height={h + 20} cursor={cursor} chunks={chunks} onSeek={onSeek} />
        {d > 1 && <Lane name="gripper" series={[{ c: "var(--ax-grip)", pts: col(d - 1) }]} xMax={xMax} height={36} cursor={cursor} onSeek={onSeek} />}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      {d >= 3 && <Lane name="translation" keys={AX.map((a) => k(a.c, `d${a.name}`))} series={AX.slice(0, Math.min(3, d - (d > 3 ? 1 : 0))).map((a, i) => ({ c: a.c, pts: col(i) }))}
        xMax={xMax} height={h} cursor={cursor} chunks={chunks} onSeek={onSeek} />}
      {d >= 7 && <Lane name="rotation" keys={AX.map((a) => k(a.c, `r${a.name}`, true))} series={AX.map((a, i) => ({ c: a.c, pts: col(3 + i), dash: true }))}
        xMax={xMax} height={h} cursor={cursor} chunks={chunks} onSeek={onSeek} />}
      {d < 3 && <Lane name="command" series={Array.from({ length: d }, (_, i) => ({ c: AX[i % 3].c, pts: col(i) }))} xMax={xMax} height={h} cursor={cursor} chunks={chunks} onSeek={onSeek} />}
      {d >= 4 && <Lane name="gripper" keys={[k("var(--ax-grip)", "close > 0")]} series={[{ c: "var(--ax-grip)", pts: col(d - 1) }]} xMax={xMax} height={36}
        yRange={[-1.3, 1.3]} cursor={cursor} onSeek={onSeek} />}
      {judge && <Lane name="success judge" keys={<span className="key">{judge.name} · p(task complete)</span>} series={[{ c: "var(--ok)", pts: judge.pts }]} area
        xMax={xMax} height={44} yRange={[0, 1]} cursor={cursor} onSeek={onSeek} />}
    </div>
  );
}
