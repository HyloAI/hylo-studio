// Live workcell: one episode through the real kernel and safety shield, streamed frame by frame.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { liveSocket, post, shortTask, useApi } from "../api";
import { Icon } from "../components/icons";
import { PageHead, Panel, Pill, Reveal, Seg } from "../components/parts";
import { Timeline, Traces, Viewport } from "../components/Telemetry";

type Msg = Record<string, any>;
interface LogLine { s: number; k: string; t: string }

function steeringPath(agent: any): string | null {
  if (agent?.params?.params?.steering) return "agent.params.params.steering";
  if (agent?.params?.steering) return "agent.params.steering";
  return null;
}
const dig = (o: any, path: string) => path.split(".").reduce((a: any, k) => a?.[k], o);

export function Live() {
  const [configs] = useApi<any>("/api/configs");
  const [config, setConfig] = useState("examples/configs/libero10_steered.yaml");
  const [opts, setOpts] = useState<any>(null);
  useEffect(() => {                                   // fall back to the first config the working directory has
    const list: string[] = configs?.experiments || [];
    if (list.length && !list.includes(config)) setConfig(list[0]);
  }, [configs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [optErr, setOptErr] = useState<string | null>(null);
  const [split, setSplit] = useState("");
  const [taskId, setTaskId] = useState("");
  const [seed, setSeed] = useState<number>(0);
  const [instruction, setInstruction] = useState("");
  const [samples, setSamples] = useState(1);
  const [replan, setReplan] = useState(50);
  const [noise, setNoise] = useState(1.0);
  const [extra, setExtra] = useState("");

  const [running, setRunning] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [actions, setActions] = useState<number[][]>([]);
  const [chunks, setChunks] = useState<Msg[]>([]);
  const [safety, setSafety] = useState<Msg[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<Msg | null>(null);
  const sock = useRef<WebSocket | null>(null);
  const logEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpts(null); setOptErr(null);
    post("/api/live/options", { config }).then((o) => {
      setOpts(o);
      const sp = o.splits[o.default_split] ? o.default_split : Object.keys(o.splits)[0];
      setSplit(sp);
      const t = o.splits[sp]?.[0];
      setTaskId(t?.task_id || ""); setSeed(t?.seeds?.[0] ?? 0);
      const p = steeringPath(o.agent);
      const st = p ? dig(o, p) || {} : {};
      setSamples(st.n_samples ?? 1); setReplan(st.execution_steps ?? 50); setNoise(st.noise_scale ?? 1.0);
    }).catch((e) => setOptErr(String(e.message || e)));
  }, [config]);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "nearest" }); }, [log.length]);

  const tasks = opts?.splits?.[split] || [];
  const task = tasks.find((t: any) => t.task_id === taskId);
  const sPath = steeringPath(opts?.agent);
  const maxSteps = task?.max_steps || 520;

  function overrides(): Record<string, any> {
    const o: Record<string, any> = {};
    if (sPath) {
      const st: any = { ...(dig(opts, sPath) || {}), n_samples: samples, noise_scale: noise, execution_steps: replan };
      if (samples > 1) st.selector = st.selector && st.selector !== "first" ? st.selector : "gripper_vote_medoid";
      o[sPath] = st;
    }
    for (const line of extra.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) { const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim(); try { o[k] = JSON.parse(v); } catch { o[k] = v; } }
    }
    return o;
  }

  function start() {
    setImages({}); setActions([]); setChunks([]); setSafety([]); setResult(null); setStep(0);
    setLog([{ s: 0, k: "", t: "connecting to the workcell" }]);
    setRunning(true);
    const ws = liveSocket();
    sock.current = ws;
    const add = (s: number, t: string, k = "") => setLog((l) => [...l.slice(-300), { s, k, t }]);
    ws.onopen = () => ws.send(JSON.stringify({ config, split, task_id: taskId, seed, instruction, overrides: overrides() }));
    ws.onmessage = (ev) => {
      const m: Msg = JSON.parse(ev.data);
      if (m.type === "observation") {
        if (Object.keys(m.images).length) setImages(Object.fromEntries(Object.entries(m.images).map(([k, v]) => [k, `data:image/jpeg;base64,${v}`])));
        setStep(m.step);
      } else if (m.type === "action") setActions((a) => [...a, m.data]);
      else if (m.type === "chunk") {
        setChunks((c) => [...c, m]);
        add(m.step, `policy call · ${m.latency_s}s${m.provenance?.n_samples > 1 ? ` · best of ${m.provenance.n_samples}, disagreement ${m.provenance.disagreement}` : ""}`);
      } else if (m.type === "safety") { setSafety((s) => [...s, m]); add(m.step, `safety: ${(m.reasons || []).join(", ")} · Δ ${m.max_change}`, "w"); }
      else if (m.type === "status") add(0, m.text);
      else if (m.type === "episode.start") add(0, `episode start · ${shortTask(m.payload.task_id)} · init ${m.payload.seed}`);
      else if (m.type === "episode.end") add(m.step, `episode end · ${m.payload.status} after ${m.payload.steps} steps`, m.payload.status === "success" ? "" : "e");
      else if (m.type === "done" || m.type === "failed") { setResult(m); setRunning(false); if (m.type === "failed") add(step, m.error, "e"); }
    };
    ws.onclose = () => setRunning(false);
    ws.onerror = () => add(0, "connection to the workcell failed", "e");
  }

  const chunkSteps = useMemo(() => chunks.map((c) => c.step), [chunks]);
  const cams = Object.keys(images).length ? Object.keys(images) : ["agentview", "wrist"];
  const last = chunks[chunks.length - 1];

  return (
    <>
      <PageHead crumbs={[["Live workcell"]]} title={task ? shortTask(task.task_id) : "Live workcell"}
        aside={result?.type === "done" && <Link className="btn" to={`/runs/${encodeURIComponent(result.run_id)}/episodes/${encodeURIComponent(result.episode_id)}`}>Open the replay<Icon.arrow /></Link>} />

      <div className="cols side">
        <div className="stack">
          <div className="panel">
            <div className="ph">
              <span className="label">Cameras</span><span className="grow" />
              {running && <Pill v="running" label="live" />}
              {result?.type === "done" && <Pill v={result.status} />}
              {result?.type === "failed" && <Pill v="failed" />}
            </div>
            <div className="pb stack" style={{ gap: 14 }}>
              <div className="views">
                {cams.map((c) => <Viewport key={c} cam={c} step={step} maxSteps={maxSteps} live={running} src={images[c]}
                  empty={running ? "loading…" : "ready"} />)}
              </div>
              <div className="row" style={{ gap: 24 }}>
                <div><div className="label">step</div><div className="num" style={{ fontSize: 18 }}>{step}<span className="faint"> / {maxSteps}</span></div></div>
                <div><div className="label">policy calls</div><div className="num" style={{ fontSize: 18 }}>{chunks.length}</div></div>
                <div><div className="label">last call</div><div className="num" style={{ fontSize: 18 }}>{last ? `${last.latency_s}s` : "–"}</div></div>
                <div><div className="label">safety</div><div className={`num ${safety.length ? "haz" : ""}`} style={{ fontSize: 18 }}>{safety.length}</div></div>
                <div className="grow" />
                {instruction && <div style={{ maxWidth: 360, fontSize: 12.5 }} className="dim">agent hears “{instruction}”</div>}
              </div>
              <Timeline max={maxSteps} done={step} cursor={step} chunks={chunkSteps} safety={safety.map((s) => ({ step: s.step, title: (s.reasons || []).join(", ") }))} />
            </div>
          </div>
          <Panel title="Executed actions">
            <Traces actions={actions} xMax={Math.max(maxSteps, actions.length)} cursor={step} chunks={chunkSteps} />
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Job ticket">
            <div className="stack" style={{ gap: 12 }}>
              <label className="field"><span className="label">experiment</span>
                <select id="cfg" value={config} onChange={(e) => setConfig(e.target.value)} disabled={running}>
                  {(configs?.experiments || [config]).map((c: string) => <option key={c} value={c}>{c.replace("examples/configs/", "").replace(".yaml", "")}</option>)}
                </select>
              </label>
              {optErr && <div className="err" style={{ fontSize: 12.5 }}>{optErr}</div>}
              {opts && <>
                <div className="row tight">
                  <label className="field grow"><span className="label">split</span>
                    <select id="split" value={split} disabled={running} onChange={(e) => { setSplit(e.target.value); const t = opts.splits[e.target.value]?.[0]; setTaskId(t?.task_id || ""); setSeed(t?.seeds?.[0] ?? 0); }}>
                      {Object.keys(opts.splits).map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ width: 96 }}><span className="label">init state</span>
                    <select id="seed" value={seed} onChange={(e) => setSeed(+e.target.value)} disabled={running}>
                      {(task?.seeds || []).map((s: number) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
                <label className="field"><span className="label">task</span>
                  <select id="task" value={taskId} disabled={running} onChange={(e) => { setTaskId(e.target.value); const t = tasks.find((x: any) => x.task_id === e.target.value); setSeed(t?.seeds?.[0] ?? 0); }}>
                    {tasks.map((t: any) => <option key={t.task_id} value={t.task_id}>{shortTask(t.task_id)}</option>)}
                  </select>
                </label>
                <label className="field"><span className="label">instruction the agent hears</span>
                  <textarea id="instr" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={running}
                    placeholder={task?.instruction || ""} />
                </label>
                {sPath && <>
                  <hr className="sep" style={{ margin: "2px 0" }} />
                  <div className="label" style={{ color: "var(--ink-2)" }}>Steering</div>
                  <div className="field"><span className="label">samples per call</span><Seg value={samples} options={[1, 2, 4, 8]} onChange={setSamples} disabled={running} /></div>
                  <div className="field"><span className="label">replan every (steps)</span><Seg value={replan} options={[5, 10, 25, 50]} onChange={setReplan} disabled={running} /></div>
                  <div className="field"><span className="label">noise scale · {noise.toFixed(1)}</span>
                    <input id="noise" type="range" min={0} max={2} step={0.1} value={noise} onChange={(e) => setNoise(+e.target.value)} disabled={running} /></div>
                </>}
                <Reveal label="More overrides">
                  <textarea id="extra" rows={3} className="mono" value={extra} onChange={(e) => setExtra(e.target.value)} disabled={running} placeholder={"agent.params.params.num_threads=8"} />
                </Reveal>
                <div className="row tight">
                  {!running ? <button className="btn go big grow" onClick={start} disabled={!taskId}><Icon.play />Run episode</button>
                    : <button className="btn stop big grow" onClick={() => post("/api/live/stop")}><Icon.stop />Stop</button>}
                </div>
              </>}
            </div>
          </Panel>
          <Panel title="Event log">
            <div className="console" style={{ maxHeight: 260 }}>
              {log.length ? log.map((l, i) => <div key={i}><span className="t">{l.s}</span><span className={l.k}>{l.t}</span></div>) : <span className="faint">–</span>}
              <div ref={logEnd} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
