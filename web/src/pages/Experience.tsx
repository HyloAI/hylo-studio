// What the system has learned, by role: behaviour (gated), instruments (calibrated), proposal knowledge (voted).
import { useState } from "react";
import { ago, pct, useApi } from "../api";
import { Err, Loading, PageHead, Panel, Pill } from "../components/parts";

const TABS: [string, string][] = [["skills", "Skills"], ["lessons", "Lessons"], ["memories", "Action memory"], ["artifacts", "Artifacts"]];

export function Experience() {
  const [tab, setTab] = useState("skills");
  return (
    <>
      <PageHead title="Experience" />
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "skills" && <Skills />}
      {tab === "lessons" && <Lessons />}
      {tab === "memories" && <Memories />}
      {tab === "artifacts" && <Artifacts />}
    </>
  );
}

function Skills() {
  const [libs, err] = useApi<any[]>("/api/skills");
  if (err) return <Err e={err} />;
  if (!libs) return <Loading />;
  if (!libs.length) return <div className="empty-state">No skill library yet. Build one from a campaign with <code>hylo skills CAMPAIGN --out runs/skills/NAME</code>.</div>;
  return <div className="stack">{libs.map((lib) => {
    const order = { verified: 0, proposed: 1, refuted: 2, deprecated: 3 } as Record<string, number>;
    const skills = [...lib.skills].sort((a, b) => (order[a.status] - order[b.status]) || ((b.evidence?.effect ?? -1) - (a.evidence?.effect ?? -1)));
    return (
      <Panel key={lib.path} title={lib.path} right={<span className="faint" style={{ fontSize: 12 }}>{lib.skills.filter((s: any) => s.status === "verified").length} verified of {lib.skills.length}</span>} flush>
        <table className="tbl">
          <thead><tr><th>skill</th><th>procedure</th><th>evidence</th><th>status</th></tr></thead>
          <tbody>{skills.map((s: any) => (
            <tr key={s.name + s.version}>
              <td style={{ whiteSpace: "nowrap" }}><div className="mono" style={{ fontSize: 12.5 }}>{s.name}@{s.version}</div><div className="faint" style={{ fontSize: 12 }}>{s.kind}</div></td>
              <td style={{ maxWidth: 520 }}><div>{s.description}</div>
                <div className="mono faint" style={{ fontSize: 11.5, marginTop: 3 }}>{Object.entries(s.body?.steering || s.body || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("  ").slice(0, 140)}</div></td>
              <td className="num" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{s.evidence?.effect !== undefined ? <>
                <span className={s.evidence.effect > 0 ? "sig" : ""}>{s.evidence.effect > 0 ? "+" : ""}{Math.round(s.evidence.effect * 100)} pts</span>
                <div className="faint">{s.evidence.gate_split} · {s.evidence.wins}/{s.evidence.losses}{s.evidence.p_value != null && ` · p ${Number(s.evidence.p_value).toFixed(3)}`}</div></> : "–"}</td>
              <td><Pill v={s.status} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    );
  })}</div>;
}

function Lessons() {
  const [books, err] = useApi<any[]>("/api/lessons");
  if (err) return <Err e={err} />;
  if (!books) return <Loading />;
  if (!books.length) return <div className="empty-state">No lesson book yet.</div>;
  return <div className="stack">{books.map((b) => (
    <div key={b.path} className="cols side">
      <Panel title={b.path} flush>
        {b.lessons.map((l: any) => (
          <div key={l.id} style={{ padding: 14, borderBottom: "1px solid var(--line)", display: "grid", gridTemplateColumns: "92px minmax(0,1fr) auto", gap: 14 }}>
            <Pill v={l.kind === "pitfall" ? "failure" : "success"} label={l.kind} />
            <div><div style={{ fontWeight: 600 }}>{l.title}</div><div className="dim" style={{ fontSize: 13, marginTop: 3 }}>{l.content}</div>
              <div className="faint mono" style={{ fontSize: 11.5, marginTop: 6 }}>{l.scope} · {l.evidence?.length || 0} cited episodes · {l.id}</div></div>
            <div className="num" style={{ textAlign: "right", fontSize: 12.5, whiteSpace: "nowrap" }}><span className="ok">+{l.helpful}</span> <span className="bad">−{l.harmful}</span><div className="faint">{l.status}</div></div>
          </div>
        ))}
      </Panel>
      <Panel title="Curation log">
        <div className="console">{b.ops.slice().reverse().map((o: any, i: number) => (
          <div key={i}><span className="t">{o.t ? new Date(o.t * 1000).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}</span>
            <span className={o.error ? "e" : ""}>{o.op} {o.id || ""} <span className="faint">{o.source}</span></span></div>
        ))}</div>
      </Panel>
    </div>
  ))}</div>;
}

function Range({ p, color }: { p: any; color: string }) {
  if (!p?.p50) return <span className="faint">–</span>;
  const lo = 0.75, hi = 1.0, X = (v: number) => `${Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100}%`;
  return (
    <div style={{ position: "relative", height: 14 }}>
      <i style={{ position: "absolute", left: 0, right: 0, top: 6, height: 1, background: "var(--grid)" }} />
      <i style={{ position: "absolute", left: X(p.p5), right: `calc(100% - ${X(p.p95)})`, top: 5, height: 3, background: color, opacity: 0.4 }} />
      <i style={{ position: "absolute", left: X(p.p25), right: `calc(100% - ${X(p.p75)})`, top: 3, height: 7, background: color, opacity: 0.7, borderRadius: 1 }} />
      <i style={{ position: "absolute", left: `calc(${X(p.p50)} - 1px)`, top: 0, width: 2, height: 14, background: color }} />
    </div>
  );
}

function Memories() {
  const [ms, err] = useApi<any[]>("/api/memories");
  if (err) return <Err e={err} />;
  if (!ms) return <Loading />;
  return (
    <div className="stack">
      <div className="cols c2">{ms.map((m) => (
        <Panel key={m.path} title={m.path} right={<span className="mono faint" style={{ fontSize: 11.5 }}>{m.digest}</span>}>
          <div className="stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 28 }}>
              <div><div className="label">segments</div><div className="num" style={{ fontSize: 22 }}>{m.segments?.toLocaleString()}</div></div>
              <div><div className="label">episodes</div><div className="num" style={{ fontSize: 22 }}>{m.episodes ?? "–"}</div></div>
              <div><div className="label">tasks</div><div className="num" style={{ fontSize: 22 }}>{m.tasks?.length ?? "–"}</div></div>
              <div><div className="label">from</div><div style={{ marginTop: 4 }}>{(m.splits || []).join(" + ")}</div></div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <div className="label">nearest-neighbour similarity</div>
              <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) 54px", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                <span className="dim">same task</span><Range p={m.nn_same_task_other_episode} color="var(--signal)" /><span className="num">{m.nn_same_task_other_episode?.p50?.toFixed(3)}</span>
                <span className="dim">other tasks</span><Range p={m.nn_other_task} color="var(--trace-a)" /><span className="num">{m.nn_other_task?.p50?.toFixed(3)}</span>
              </div>
              <div className="scale" style={{ marginLeft: 130, marginRight: 64 }}><span>0.75</span><span>0.875</span><span>1.00</span></div>
            </div>
          </div>
        </Panel>
      ))}</div>
    </div>
  );
}

function Artifacts() {
  const [arts, err] = useApi<any[]>("/api/artifacts");
  const [open, setOpen] = useState<string | null>(null);
  if (err) return <Err e={err} />;
  if (!arts) return <Loading />;
  if (!arts.length) return <div className="empty-state">No sealed artifact yet. Train one with <code>hylo learn JOB.json</code>.</div>;
  return (
    <Panel flush>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>artifact</th><th>kind</th><th>role</th><th>built from</th><th>quality</th><th className="r">sealed</th></tr></thead>
          <tbody>{arts.map((a) => [
            <tr key={a.path} className="click" onClick={() => setOpen(open === a.path ? null : a.path)}>
              <td><div className="mono" style={{ fontSize: 12.5 }}>{a.path}</div><div className="mono faint" style={{ fontSize: 11.5 }}>{a.digest}</div></td>
              <td>{a.kind.replace(/_/g, " ")}</td>
              <td><span className={`chip ${a.role === "instrument" ? "" : ""}`}>{a.role}</span></td>
              <td><div className="row tight">{a.splits.map((s: string) => <span key={s} className="chip">{s}</span>)}</div><div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>{a.sources.length} sources</div></td>
              <td style={{ fontSize: 12.5 }}>{a.calibration ? <div className="stack" style={{ gap: 4 }}><span className="num">AUC {a.calibration.auc?.toFixed(2)} · {pct(a.calibration.recall)} recall at {pct(a.calibration.precision)} precision</span>
                {a.calibration.ready ? <Pill v="success" label="calibrated" /> : <Pill v="failure" label="not ready" />}</div>
                : a.metrics?.cv?.same_state_pair_accuracy !== undefined ? <span className="num">same-state pair accuracy {pct(a.metrics.cv.same_state_pair_accuracy)}</span> : <span className="faint">–</span>}</td>
              <td className="r faint" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{a.created_at ? ago(a.created_at) : ""}</td>
            </tr>,
            open === a.path && <tr key={a.path + "x"}><td colSpan={6}><div className="stack" style={{ gap: 8 }}><span className="faint mono" style={{ fontSize: 11.5 }}>builder {a.builder}</span>
              <pre className="json">{JSON.stringify({ metrics: a.metrics, calibration: a.calibration, sources: a.sources }, null, 2)}</pre></div></td></tr>,
          ])}</tbody>
        </table>
      </div>
    </Panel>
  );
}
