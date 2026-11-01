// Operator station: run episodes on a workcell (real robot or simulator) with a remote policy, confirm resets,
// judge outcomes, stop. The e-stop is always available, whatever the role.
import { useEffect, useMemo, useRef, useState } from "react";
import { get, post, shortTask, useApi } from "../api";
import { Icon } from "../components/icons";
import { PageHead, Panel, Pill } from "../components/parts";
import { Timeline, Traces, Viewport } from "../components/Telemetry";

type Msg = Record<string, any>;

function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const token = new URLSearchParams(window.location.search).get("token") || localStorage.getItem("hylo-token") || "";
  return `${proto}://${window.location.host}${path}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

const STATE_PILL: Record<string, string> = { idle: "", starting: "running", running: "running", awaiting_reset: "pending",
  awaiting_verdict: "pending", fault: "failed" };

export function Operator() {
  const [me] = useApi<any>("/api/me");
  const [cells, setCells] = useState<any[]>([]);
  const [policies] = useApi<any[]>("/api/policies");
  const [name, setName] = useState<string>("");
  const [policy, setPolicy] = useState<string>("");
  const [taskId, setTaskId] = useState("");
  const [seed, setSeed] = useState<string>("");
  const [instruction, setInstruction] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [images, setImages] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [actions, setActions] = useState<number[][]>([]);
  const [chunks, setChunks] = useState<number[]>([]);
  const [safety, setSafety] = useState<Msg[]>([]);
  const [holds, setHolds] = useState(0);
  const [phase, setPhase] = useState<string>("");          // "" | awaiting_reset | running | awaiting_verdict | done
  const [log, setLog] = useState<{ s: number; k: string; t: string }[]>([]);
  const logEnd = useRef<HTMLDivElement | null>(null);

  const role = me?.role || "viewer";
  const can = (r: string) => ["viewer", "operator", "approver"].indexOf(role) >= ["viewer", "operator", "approver"].indexOf(r);

  useEffect(() => {
    const pull = () => get<any[]>("/api/workcells").then((c) => { setCells(c); setName((n) => n || c[0]?.name || ""); }).catch(() => {});
    pull();
    const id = setInterval(pull, 2000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "nearest" }); }, [log.length]);

  const cell = cells.find((c) => c.name === name);
  const st = cell?.status;
  const tasks: [string, string][] = st?.tasks || [];

  useEffect(() => {
    if (!name) return;
    const ws = new WebSocket(wsUrl(`/api/workcells/${encodeURIComponent(name)}/events`));
    const add = (s: number, t: string, k = "") => setLog((l) => [...l.slice(-300), { s, k, t }]);
    ws.onmessage = (ev) => {
      const m: Msg = JSON.parse(ev.data);
      if (m.type === "observation") {
        if (Object.keys(m.images || {}).length) setImages(Object.fromEntries(Object.entries(m.images).map(([k, v]) => [k, `data:image/jpeg;base64,${v}`])));
        setStep(m.step);
      } else if (m.type === "action") setActions((a) => [...a.slice(-2000), m.data]);
      else if (m.type === "chunk") { setChunks((c) => [...c, m.step]); add(m.step, `chunk · ${m.latency_s}s · dropped ${m.provenance?.dropped ?? 0} stale, queued ${m.provenance?.queued ?? "?"}`); }
      else if (m.type === "safety") { setSafety((s) => [...s, m]); add(m.step, `safety: ${(m.reasons || []).join(", ")} · Δ ${m.max_change}`, "w"); }
      else if (m.type === "x.workcell.hold") setHolds((h) => h + 1);
      else if (m.type === "episode.start") {
        setImages({}); setActions([]); setChunks([]); setSafety([]); setHolds(0); setStep(0); setPhase("running");
        add(0, `episode start · ${shortTask(m.payload.task_id)}`);
      } else if (m.type === "operator.awaiting_reset") { setPhase("awaiting_reset"); add(m.step, "waiting for the operator to reset the scene", "w"); }
      else if (m.type === "operator.awaiting_verdict") { setPhase("awaiting_verdict"); add(m.step, "episode over: waiting for the operator's verdict", "w"); }
      else if (m.type === "operator.reset_done") { setPhase("running"); add(m.step, `reset confirmed by ${m.payload.by || "operator"}`); }
      else if (m.type === "episode.end") {
        const s = m.payload.status;
        setPhase("done");
        add(m.step, `episode end · ${s} · ${m.payload.termination_reason} · ${m.payload.holds} holds`, s === "success" ? "" : s === "unlabeled" ? "w" : "e");
      } else if (m.type.startsWith("operator.")) add(m.step, `${m.type.slice(9)}${m.payload?.verdict ? ` · ${m.payload.verdict}` : ""} · ${m.payload?.by || ""}`, m.type === "operator.estop" ? "e" : "");
      else if (m.type === "error") add(m.step, m.payload.message, "e");
      else if (m.type === "done") { setPhase("done"); add(m.steps, `recorded · ${m.status}`); }
      else if (m.type === "failed") { setPhase("done"); add(step, m.error, "e"); }
      else if (m.type === "status") add(0, m.text);
    };
    return () => ws.close();
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  async function op(type: string, extra: Msg = {}) {
    setMsg(null);
    try { await post(`/api/workcells/${encodeURIComponent(name)}/operator`, { type, ...extra }); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }
  async function start() {
    setMsg(null);
    const body: Msg = { instruction };
    if (tasks.length && taskId) { body.task_id = taskId; if (seed !== "") body.seed = +seed; }
    if (policy) body.policy = policy;
    try { await post(`/api/workcells/${encodeURIComponent(name)}/episodes`, body); setPhase("running"); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }

  const state = st?.state || (cell && !cell.reachable ? "unreachable" : "–");
  const busy = ["running", "starting", "awaiting_reset", "awaiting_verdict"].includes(state);
  const awaitingReset = phase === "awaiting_reset" || state === "awaiting_reset";
  const awaitingVerdict = phase === "awaiting_verdict" || state === "awaiting_verdict";
  const cams = Object.keys(images).length ? Object.keys(images) : ["camera"];
  const xMax = Math.max(100, actions.length);
  const holdPct = useMemo(() => (step ? Math.round((holds / step) * 100) : 0), [holds, step]);

  return (
    <>
      <PageHead title="Operator station" aside={
        <div className="row tight">
          <span className="label">role</span><span className="chip">{role}</span>
          <button className="btn stop big" onClick={() => op("estop")} disabled={!name} title="Stops the robot and latches a fault until an operator clears it">
            <Icon.stop />E-STOP</button>
        </div>} />

      <div className="cols side-l">
        <div className="stack">
          <Panel title="Workcells">
            <div className="stack" style={{ gap: 6 }}>
              {cells.length === 0 && <div className="faint" style={{ fontSize: 12.5 }}>None configured. Start the playground with --workcell name=http://host:port.</div>}
              {cells.map((c) => (
                <button key={c.name} className="btn" style={{ justifyContent: "space-between", borderColor: c.name === name ? "var(--signal)" : undefined }}
                  onClick={() => setName(c.name)}>
                  <span><span className={`lamp ${c.status?.state === "running" ? "on" : c.reachable && c.status?.state !== "fault" ? "ok" : ""}`} />{c.name}</span>
                  <span className="faint mono" style={{ fontSize: 11 }}>{c.reachable ? c.status?.state : "unreachable"}</span>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="Episode ticket">
            <div className="stack" style={{ gap: 12 }}>
              <label className="field"><span className="label">policy server</span>
                <select id="op-policy" value={policy} onChange={(e) => setPolicy(e.target.value)} disabled={busy}>
                  <option value="">workcell default{st?.policy?.url ? ` (${st.policy.url})` : ""}</option>
                  {(policies || []).map((p) => <option key={p.name} value={p.name} disabled={!p.reachable}>{p.name} · {p.reachable ? `${p.agent} · ${p.version}` : "unreachable"}</option>)}
                </select>
              </label>
              {tasks.length > 0 && <div className="row tight">
                <label className="field grow"><span className="label">task</span>
                  <select id="op-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={busy}>
                    <option value="">free-form instruction</option>
                    {tasks.map(([id]) => <option key={id} value={id}>{shortTask(id)}</option>)}
                  </select>
                </label>
                <label className="field" style={{ width: 84 }}><span className="label">init</span>
                  <input id="op-seed" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="0" disabled={busy} /></label>
              </div>}
              <label className="field"><span className="label">{taskId ? "instruction the agent hears (optional)" : "instruction"}</span>
                <textarea id="op-instr" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy}
                  placeholder={taskId ? tasks.find(([id]) => id === taskId)?.[1] : "pick up the red block"} /></label>
              <button className="btn go big" onClick={start} disabled={!can("operator") || busy || state === "fault" || !cell?.reachable || (!taskId && !instruction.trim())}>
                <Icon.play />Start episode</button>
              {msg && <div className="err" style={{ fontSize: 12.5 }}>{msg}</div>}
            </div>
          </Panel>
        </div>

        <div className="stack">
          <div className="panel">
            <div className="ph">
              <span className="label">{name || "no workcell"}</span><span className="grow" />
              <Pill v={STATE_PILL[state] ?? ""} label={state.replace("_", " ")} />
              {st?.fault && <span className="haz" style={{ fontSize: 12.5 }}>{st.fault}</span>}
            </div>
            <div className="pb stack" style={{ gap: 14 }}>
              <div className="views cap">
                {cams.map((c) => <Viewport key={c} cam={c} step={step} live={phase === "running"} src={images[c]}
                  empty={state === "running" ? "waiting for frames…" : "no episode running"} />)}
              </div>
              <div className="row" style={{ gap: 24 }}>
                <div><div className="label">step</div><div className="num" style={{ fontSize: 18 }}>{step}</div></div>
                <div><div className="label">chunks</div><div className="num" style={{ fontSize: 18 }}>{chunks.length}</div></div>
                <div><div className="label">holding</div><div className={`num ${holdPct > 30 ? "haz" : ""}`} style={{ fontSize: 18 }}>{holdPct}%</div></div>
                <div><div className="label">safety</div><div className={`num ${safety.length ? "haz" : ""}`} style={{ fontSize: 18 }}>{safety.length}</div></div>
                <div className="grow" />
                <div className="row tight">
                  {awaitingReset && <button className="btn go" onClick={() => op("reset_done")} disabled={!can("operator")}>Scene is reset</button>}
                  {awaitingVerdict && <>
                    <button className="btn go" onClick={() => op("verdict", { verdict: "success" })} disabled={!can("operator")}>Success</button>
                    <button className="btn" onClick={() => op("verdict", { verdict: "partial" })} disabled={!can("operator")}>Partial</button>
                    <button className="btn" onClick={() => op("verdict", { verdict: "failure" })} disabled={!can("operator")}>Failure</button>
                  </>}
                  {busy && <button className="btn" onClick={() => op("stop")} disabled={!can("operator")}>Stop</button>}
                  {state === "fault" && <button className="btn" onClick={() => op("clear_fault")} disabled={!can("operator")}>Clear fault</button>}
                </div>
              </div>
              <Timeline max={xMax} done={step} cursor={step} chunks={chunks} safety={safety.map((s) => ({ step: s.step, title: (s.reasons || []).join(",") }))} />
            </div>
          </div>
          <div className="cols c2">
            <Panel title="Commanded actions"><Traces actions={actions} xMax={xMax} cursor={step} chunks={chunks} compact joints={(actions[0]?.length || 0) !== 7} /></Panel>
            <Panel title="Event log">
              <div className="console" style={{ maxHeight: 280 }}>
                {log.length ? log.map((l, i) => <div key={i}><span className="t">{l.s}</span><span className={l.k}>{l.t}</span></div>) : <span className="faint">–</span>}
                <div ref={logEnd} />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
