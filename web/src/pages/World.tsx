// The world page (RFC-0008): a stage and the world built from it, a free view to orbit, robot actions by hand, and a
// chat with a model that builds and runs the world through the same tools (`hylo world chat` behind the scenes).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, post, useApi } from "../api";
import { Err, Loading, PageHead, Panel } from "../components/parts";

const token = new URLSearchParams(window.location.search).get("token") || localStorage.getItem("hylo-token") || "";
const withToken = (p: string) => (token ? p + (p.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) : p);

export function Worlds() {
  const [stages, err, reload] = useApi<any[]>("/api/world/stages");
  const [name, setName] = useState("");
  const nav = useNavigate();
  if (err) return <Err e={err} />;
  if (!stages) return <Loading what="stages" />;
  const create = async () => {
    if (!name) return;
    await post("/api/world/stages", { name });
    nav(`/world/${encodeURIComponent(name)}`);
  };
  return (
    <>
      <PageHead title="World" />
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="new stage name (lower case)" value={name} onChange={(e) => setName(e.target.value.toLowerCase())}
          style={{ maxWidth: 260 }} />
        <button className="btn go" onClick={create} disabled={!/^[a-z][a-z0-9_]*$/.test(name)}>Create stage</button>
        <button className="btn" onClick={reload}>Refresh</button>
      </div>
      <Panel flush>
        <table className="tbl">
          <thead><tr><th>stage</th><th className="r">revision</th><th className="r">entities</th><th>chat</th></tr></thead>
          <tbody>{stages.map((s) => (
            <tr key={s.name} className="click" onClick={() => nav(`/world/${encodeURIComponent(s.name)}`)}>
              <td>{s.name}</td><td className="r num">{s.revision}</td><td className="r num">{s.entities}</td>
              <td className="faint">{s.chat ? "running" : ""}</td>
            </tr>))}</tbody>
        </table>
        {!stages.length && <div className="empty-state">No stages yet: create one, then ask the model to build a scene.</div>}
      </Panel>
    </>
  );
}

function Orbit({ stage, version }: { stage: string; version: number }) {
  const [cam, setCam] = useState({ azimuth: 135, elevation: -25, distance: 3.2, lx: 0.3, ly: 0, lz: 0.4 });
  const [src, setSrc] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams(Object.entries(cam).map(([k, v]) => [k, String(v)]));
      const url = withToken(`/api/world/${encodeURIComponent(stage)}/view?${q}&v=${version}`);
      fetch(url).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
        setErr(null);
        setSrc(URL.createObjectURL(await r.blob()));
      }).catch((e) => setErr(String(e.message || e)));
    }, 120);
    return () => clearTimeout(t);
  }, [stage, cam, version]);
  return (
    <div style={{ position: "relative", userSelect: "none" }}
      onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; }}
      onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}
      onMouseMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
        drag.current = { x: e.clientX, y: e.clientY };
        setCam((c) => ({ ...c, azimuth: c.azimuth - dx * 0.4, elevation: Math.max(-89, Math.min(-2, c.elevation - dy * 0.3)) }));
      }}
      onWheel={(e) => setCam((c) => ({ ...c, distance: Math.max(0.5, Math.min(20, c.distance * (e.deltaY > 0 ? 1.1 : 0.9))) }))}>
      {src ? <img src={src} alt="world view" style={{ width: "100%", borderRadius: 4, display: "block", cursor: "grab" }} draggable={false} />
        : <div className="empty-state">{err || "building the world…"}</div>}
      {err && src && <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{err}</div>}
      <div className="faint mono" style={{ fontSize: 11, marginTop: 6 }}>drag to orbit · wheel to zoom · az {cam.azimuth.toFixed(0)}° el {cam.elevation.toFixed(0)}° {cam.distance.toFixed(1)} m</div>
    </div>
  );
}

function Transcript({ stage, onChange }: { stage: string; onChange: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const after = useRef(0);
  const first = useRef(true);
  const changed = useRef(onChange);
  changed.current = onChange;                      // the latest callback, without restarting the polling
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    after.current = 0;
    first.current = true;
    setRows([]);
    let alive = true;
    const pull = () => get(`/api/world/${encodeURIComponent(stage)}/transcript?after=${after.current}`).then((d) => {
      if (!alive) return;
      if (d.events.length) {
        setRows((r) => [...r, ...d.events].slice(-400));
        if (!first.current && d.events.some((e: any) => e.kind === "act")) changed.current();
      }
      first.current = false;
      after.current = d.lines;
      setRunning(d.running);
    }).catch(() => {});
    pull();
    const id = setInterval(pull, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [stage]);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [rows]);
  return (
    <div ref={box} style={{ maxHeight: 520, overflowY: "auto", overflowX: "hidden", display: "grid", gap: 8, overflowWrap: "anywhere", minWidth: 0 }}>
      {rows.map((e) => <Line key={e.n} e={e} />)}
      {!rows.length && <div className="faint" style={{ fontSize: 13 }}>Ask for a scene, e.g. “a table with a red cube, a Panda next to it and a Go2 that walks around them”.</div>}
      {running && <div className="faint mono" style={{ fontSize: 11 }}>session running…</div>}
    </div>
  );
}

function Line({ e }: { e: any }) {
  if (e.type === "operator") return <div style={{ fontWeight: 600 }}>› {e.message}</div>;
  if (e.type === "turn") return e.text ? <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5 }}>{e.text}</div> : null;
  if (e.type === "result") {
    let body: any = null;
    try { body = JSON.parse(e.result); } catch { body = null; }
    const ok = e.ok;
    return (
      <div className="mono" style={{ fontSize: 11.5 }}>
        <span style={{ color: e.kind === "act" ? "var(--signal)" : "var(--ink-2)" }}>{e.kind === "act" ? "▶" : "·"} {e.name}</span>
        <span className={ok ? "faint" : ""} style={{ color: ok ? undefined : "var(--bad)" }}> {ok ? summary(e.name, body) : `${body?.error?.code}: ${body?.error?.message}`}</span>
      </div>
    );
  }
  if (e.type === "view" && e.image) return <img src={e.image} alt="after the action" style={{ width: "100%", borderRadius: 4 }} />;
  if (e.type === "summary") return <div className="faint" style={{ fontSize: 12 }}>— session ended after {e.calls ?? "?"} model calls</div>;
  return null;
}

function summary(name: string, b: any): string {
  if (!b) return "";
  if (b.receipts) return b.receipts.map((r: any) => `${r.robot} ${r.kind}: ${r.status}${r.reason ? " (" + r.reason.slice(0, 60) + ")" : ""}`).join("; ");
  if (name === "check") return b.satisfied ? "satisfied" : `not satisfied: ${(b.reasons || []).join(", ")}`;
  if (name === "stage_edit") return `revision ${b.revision}`;
  if (name === "world_build") return `generation ${b.generation}, robots ${Object.keys(b.robots || {}).join(", ")}`;
  return JSON.stringify(b).slice(0, 110);
}

export function WorldStage() {
  const { stage = "" } = useParams();
  const [o, err, reload] = useApi<any>(`/api/world/${encodeURIComponent(stage)}`);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [act, setAct] = useState('{"robot": "", "kind": "hold", "duration_s": 1}');
  const [goal, setGoal] = useState('{"op": "lifted", "entity": "cube", "min_z": 0.5}');
  const [out, setOut] = useState<any>(null);
  const bump = useCallback(() => { setVersion((v) => v + 1); reload(); }, [reload]);
  if (err) return <Err e={err} />;
  if (!o) return <Loading what="stage" />;
  const call = async (tool: string, args: any) => {
    setBusy(tool);
    try {
      const r = await post(`/api/world/${encodeURIComponent(stage)}/call`, { tool, arguments: args });
      setOut(r);
      bump();
    } finally { setBusy(""); }
  };
  const send = async () => {
    if (!msg.trim()) return;
    await post(`/api/world/${encodeURIComponent(stage)}/chat`, { message: msg });
    setMsg("");
  };
  const ents: any[] = o.stage?.entities || [];
  return (
    <>
      <PageHead crumbs={[["World", "/world"], [stage]]} title={stage}>
        <span className="mono faint" style={{ fontSize: 12 }}>revision {o.stage?.revision}{o.world ? ` · generation ${o.world.generation} · step ${o.world.step}` : " · world not built"}</span>
      </PageHead>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(360px, 2.2fr) minmax(300px, 1.6fr)", gap: 16, alignItems: "start" }}>
        <div className="stack">
          <Panel title="Entities" right={<button className="btn" disabled={!!busy} onClick={() => call("world_build", {})}>{busy === "world_build" ? "building…" : "Build world"}</button>}>
            <div className="stack" style={{ gap: 6 }}>
              {ents.map((e) => (
                <div key={e.id} className="row tight" style={{ justifyContent: "space-between" }}>
                  <span><b style={{ fontWeight: 500 }}>{e.id}</b> <span className="faint" style={{ fontSize: 12 }}>{e.pack || e.shape?.type || e.kind}</span></span>
                  <span className="mono faint" style={{ fontSize: 11 }}>{e.pos?.map((v: number) => v.toFixed(2)).join(", ")}</span>
                </div>))}
              {!ents.length && <div className="faint" style={{ fontSize: 13 }}>Empty stage.</div>}
            </div>
          </Panel>
          <Panel title="Act by hand">
            <div className="stack" style={{ gap: 8 }}>
              <textarea value={act} onChange={(e) => setAct(e.target.value)} rows={4} className="mono" style={{ fontSize: 12 }} />
              <button className="btn" disabled={!!busy || !o.world} onClick={() => {
                const a = JSON.parse(act);
                call("act", { actions: [{ ...a, expected_generation: o.world?.generation }] });
              }}>Run action</button>
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} className="mono" style={{ fontSize: 12 }} />
              <button className="btn" disabled={!!busy || !o.world} onClick={() => call("check", { goal: JSON.parse(goal) })}>Check goal</button>
              {out && <pre className="json" style={{ maxHeight: 220, overflow: "auto", fontSize: 11 }}>{JSON.stringify(out.ok ? out.result : out.error, null, 1)}</pre>}
            </div>
          </Panel>
        </div>
        <Panel title="View"><Orbit stage={stage} version={version} /></Panel>
        <Panel title="Chat" right={<button className="btn" onClick={() => post(`/api/world/${encodeURIComponent(stage)}/stop`)}>Stop</button>}>
          <div className="stack" style={{ gap: 10 }}>
            <Transcript stage={stage} onChange={bump} />
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} placeholder="Ask the model to build or do something…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button className="btn go" onClick={send} disabled={!msg.trim()}>Send</button>
              <Link to="/runs" className="faint" style={{ fontSize: 12 }}>sessions are traced (hylo watch)</Link>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
