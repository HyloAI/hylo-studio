// Background jobs: the regular wc commands, started from the browser, with their logs.
import { useEffect, useState } from "react";
import { ago, get, post, useApi } from "../api";
import { Icon } from "../components/icons";
import { Err, PageHead, Panel, Pill, Seg } from "../components/parts";

const KINDS: Record<string, string> = { run: "Evaluate", evolve: "Campaign", calibrate: "Calibrate judge" };

export function Jobs() {
  const [configs] = useApi<any>("/api/configs");
  const [jobs, err, reload] = useApi<any[]>("/api/jobs");
  const [kind, setKind] = useState("Evaluate");
  const [config, setConfig] = useState("examples/configs/mujoco_reach.yaml");
  const [split, setSplit] = useState("");
  const [sets, setSets] = useState("");
  const [judgeRuns, setJudgeRuns] = useState("runs/evolve runs/rsi-libero10");
  const [sel, setSel] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const k = Object.keys(KINDS).find((x) => KINDS[x] === kind)!;

  useEffect(() => { const id = setInterval(reload, 3000); return () => clearInterval(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sel) return;
    const pull = () => get(`/api/jobs/${sel}/log?tail=400`).then((r) => setLog(r.log)).catch(() => {});
    pull();
    const id = setInterval(pull, 2000);
    return () => clearInterval(id);
  }, [sel]);
  useEffect(() => {                                   // the first config of the kind in the working directory
    const list: string[] = (k === "evolve" ? configs?.campaigns : configs?.experiments) || [];
    if (list.length && !list.includes(config)) setConfig(list[0]);
  }, [k, configs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setMsg(null);
    const lines = sets.split("\n").map((s) => s.trim()).filter(Boolean);
    const args: any = k === "run" ? { config, split: split || undefined, sets: lines }
      : k === "evolve" ? { config, sets: lines }
      : { judge: { type: "judge.trace", params: { path: "artifact:l10-trace-v2@54a1efadf00d34d8" } }, runs: judgeRuns.split(/\s+/).filter(Boolean),
          splits: ["search_val"], task_prefix: "libero/libero_10/", limit: 200, out: "runs/judges/calib-playground.json" };
    try { const j = await post("/api/jobs", { kind: k, args }); setSel(j.id); reload(); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }
  const list = k === "evolve" ? configs?.campaigns : configs?.experiments;
  const cur = (jobs || []).find((j) => j.id === sel);

  return (
    <>
      <PageHead title="Jobs" />
      <div className="cols side-l">
        <div className="stack">
          <Panel title="New job">
            <div className="stack" style={{ gap: 12 }}>
              <Seg value={kind} options={Object.values(KINDS)} onChange={setKind} />
              {k !== "calibrate" && <label className="field"><span className="label">config</span>
                <select id="jcfg" value={config} onChange={(e) => setConfig(e.target.value)}>{(list || []).map((c: string) => <option key={c} value={c}>{c.replace(/^examples\//, "")}</option>)}</select></label>}
              {k === "run" && <label className="field"><span className="label">split</span><input id="jsplit" value={split} onChange={(e) => setSplit(e.target.value)} placeholder="the config's default" /></label>}
              {k === "calibrate" && <label className="field"><span className="label">runs with search_val episodes</span><input id="jruns" value={judgeRuns} onChange={(e) => setJudgeRuns(e.target.value)} /></label>}
              {k !== "calibrate" && <label className="field"><span className="label">overrides · key=value per line</span>
                <textarea id="jsets" rows={3} className="mono" value={sets} onChange={(e) => setSets(e.target.value)} placeholder={k === "run" ? "workers=4" : "cycles=1"} /></label>}
              <button className="btn go" onClick={start}><Icon.play />Start job</button>
              {msg && <div className="err" style={{ fontSize: 12.5 }}>{msg}</div>}
            </div>
          </Panel>
          <Panel title="Recent jobs" flush>
            <Err e={err} />
            <table className="tbl"><tbody>{(jobs || []).map((j) => (
              <tr key={j.id} className={`click ${sel === j.id ? "sel" : ""}`} onClick={() => setSel(j.id)}>
                <td><div className="mono" style={{ fontSize: 12 }}>{j.cmd.slice(0, 2).join(" ")}</div><div className="faint" style={{ fontSize: 11.5 }}>{ago(j.started)}</div></td>
                <td className="r"><Pill v={j.status === "finished?" ? "" : j.status} label={j.status === "finished?" ? "earlier" : j.status} /></td>
              </tr>
            ))}</tbody></table>
            {jobs && !jobs.length && <div className="empty-state">No jobs yet.</div>}
          </Panel>
        </div>
        <Panel title={cur ? `wc ${cur.cmd.join(" ")}`.slice(0, 110) : "Log"} right={cur?.status === "running" && <button className="btn stop" onClick={() => post(`/api/jobs/${sel}/stop`).then(reload)}><Icon.stop />Stop</button>}>
          <pre className="terminal" style={{ minHeight: 420 }}>{sel ? log || "waiting for output…" : "Select a job to follow its output."}</pre>
        </Panel>
      </div>
    </>
  );
}
