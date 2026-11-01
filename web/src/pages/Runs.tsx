import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ago, pct, shortTask, useApi } from "../api";
import { EpisodePlayer } from "../components/EpisodePlayer";
import { OutcomeGrid } from "../components/OutcomeGrid";
import { Err, Figs, Loading, Meter, PageHead, Panel, Reveal, Seg, SplitChip } from "../components/parts";

export function Runs() {
  const [runs, err] = useApi<any[]>("/api/runs");
  const [q, setQ] = useState("");
  const [split, setSplit] = useState("all");
  const nav = useNavigate();
  const shown = useMemo(() => (runs || []).filter((r) =>
    (split === "all" || r.split === split || (split === "external" && String(r.split).startsWith("external:"))) && (!q || `${r.run_id} ${r.name} ${r.group} ${r.agent}`.toLowerCase().includes(q.toLowerCase()))), [runs, q, split]);
  if (err) return <Err e={err} />;
  if (!runs) return <Loading what="runs" />;
  const order = ["search", "search_val", "gate", "gate_r1", "gate_r2", "heldout", "validation", "playground"];
  const splits = ["all", ...order.filter((s) => runs.some((r) => r.split === s)), ...(runs.some((r) => String(r.split).startsWith("external:")) ? ["external"] : [])];
  return (
    <>
      <PageHead title="Runs & replays" />
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg value={split} options={splits} onChange={setSplit} />
        <input id="q" placeholder="Filter by name, campaign or agent" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <span className="faint num" style={{ fontSize: 12.5 }}>{shown.length} runs</span>
      </div>
      <Panel flush>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>run</th><th>split</th><th>agent</th><th className="r">tasks</th><th className="r">episodes</th><th>success</th><th className="r">safety / ep</th><th className="r">when</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.run_id} className="click" onClick={() => nav(`/runs/${encodeURIComponent(r.run_id)}`)}>
                <td><div>{r.name || r.run_id}</div><div className="mono faint" style={{ fontSize: 11.5 }}>{r.group}</div></td>
                <td><SplitChip split={r.split} /></td><td className="mono dim" style={{ fontSize: 12 }}>{r.agent}</td>
                <td className="r num">{r.tasks}</td><td className="r num">{r.n}</td><td><Meter value={r.success} /></td>
                <td className={`r num ${r.safety_mean > 1 ? "haz" : ""}`}>{r.safety_mean?.toFixed?.(2) ?? "–"}</td>
                <td className="r faint" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{ago(r.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function RunDetail() {
  const { runId = "" } = useParams();
  const [run, err] = useApi<any>(`/api/runs/${encodeURIComponent(runId)}`);
  const nav = useNavigate();
  if (err) return <Err e={err} />;
  if (!run) return <Loading what="run" />;
  const s = run.summary;
  const byTask: Record<string, { n: number; ok: number }> = {};
  for (const x of run.samples) { const t = (byTask[x.task_id] ||= { n: 0, ok: 0 }); t.n++; if (x.status === "success") t.ok++; }
  const cells = run.samples.map((x: any) => ({
    key: x.episode_id, task_id: x.task_id, seed: x.seed,
    cls: x.status === "success" ? "s" : x.status === "failure" ? "f" : x.status === "unlabeled" ? "none" : "e",
    title: `${shortTask(x.task_id)} · init ${x.seed} · ${x.status} · ${x.steps} steps`,
  }));
  return (
    <>
      <PageHead crumbs={[["Runs", "/runs"], [s.group]]} title={s.name || s.run_id}><span className="mono" style={{ fontSize: 12 }}>{s.run_id}</span></PageHead>
      <Figs items={[
        { label: "success", value: pct(s.success, 1), sub: `${run.samples.filter((x: any) => x.status === "success").length} of ${s.n} episodes` },
        { label: "split", value: <span style={{ fontSize: 19 }}>{s.split}</span>, sub: s.benchmark },
        { label: "tasks", value: s.tasks },
        { label: "safety / episode", value: s.safety_mean?.toFixed?.(2) ?? "–" },
        { label: "agent", value: <span style={{ fontSize: 17 }}>{s.agent}</span> },
      ]} />
      <div style={{ marginTop: 16 }}>
        <Panel title="Outcomes · task × init state" right={<span className="row tight faint" style={{ fontSize: 12 }}><i className="sw" style={{ background: "var(--ok)" }} />success<i className="sw" style={{ background: "var(--bad)", marginLeft: 8 }} />failure</span>}>
          <OutcomeGrid cells={cells} rates={Object.fromEntries(Object.entries(byTask).map(([t, v]) => [t, v.ok / v.n]))}
            onPick={(c) => nav(`/runs/${encodeURIComponent(runId)}/episodes/${encodeURIComponent(c.key)}`)} />
        </Panel>
      </div>
      <div style={{ marginTop: 16 }}>
        <Panel title="Configuration">
          <div className="stack" style={{ gap: 10 }}>
            <Reveal label="Experiment config"><pre className="json">{JSON.stringify(run.config, null, 2)}</pre></Reveal>
            <Reveal label="Agent spec"><pre className="json">{JSON.stringify(run.agent, null, 2)}</pre></Reveal>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function Episode() {
  const { runId = "", episodeId = "" } = useParams();
  const [run] = useApi<any>(`/api/runs/${encodeURIComponent(runId)}`);
  const ep = run?.samples?.find((x: any) => x.episode_id === episodeId);
  return (
    <>
      <PageHead crumbs={[["Runs", "/runs"], [run?.summary?.name || runId, `/runs/${encodeURIComponent(runId)}`], ["episode"]]}
        title={ep ? `${shortTask(ep.task_id)} · init ${ep.seed}` : episodeId} />
      <EpisodePlayer runId={runId} episodeId={episodeId} />
      <div className="faint mono" style={{ fontSize: 11.5, marginTop: 12 }}>{episodeId} · <Link to={`/runs/${encodeURIComponent(runId)}`} className="sig">all episodes of this run</Link></div>
    </>
  );
}
