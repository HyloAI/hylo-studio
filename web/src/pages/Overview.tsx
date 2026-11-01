import { Link, useNavigate } from "react-router-dom";
import { ago, frameUrl, pct, shortTask, useApi } from "../api";
import { Icon } from "../components/icons";
import { Err, Loading, Meter, PageHead, Panel, Pill, SplitChip } from "../components/parts";
import { Viewport } from "../components/Telemetry";

// The improvement cascade, in the order a candidate goes through it.
const STAGES: [string, string, string][] = [
  ["proposed", "Propose", "a generator writes a config patch with a hypothesis"],
  ["screened", "Screen", "paired test on search_val init states"],
  ["gated", "Gate", "group-sequential test on fresh gate init states"],
  ["passed", "Pass", "beats the parent with no task or safety regression"],
  ["promoted", "Promote", "becomes the active version; held-out reported"],
];

export function Overview() {
  const [o, err] = useApi<any>("/api/overview");
  const nav = useNavigate();
  const [frames] = useApi<any>(o?.latest_live?.episode_id ? `/api/runs/${encodeURIComponent(o.latest_live.run_id)}/episodes/${encodeURIComponent(o.latest_live.episode_id)}` : null);
  if (err) return <Err e={err} />;
  if (!o) return <Loading />;
  const L = o.latest_live;
  const lastFrame = frames?.frames?.[frames.frames.length - 1];
  const real = (o.loop.best || []).filter((b: any) => !b.campaign.startsWith("testing"));   // skip test-double campaigns
  const best = real[0] || o.loop.best?.[0];
  const cal = o.judge?.calibration;

  return (
    <>
      <PageHead title="Workcell console" aside={<Link to="/live" className="btn go"><Icon.live />Open the live workcell</Link>} />

      <Panel title="Improvement loop · all campaigns" right={<Link to="/campaigns" className="toggle">campaigns →</Link>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 0 }}>
          {STAGES.map(([k, name, what], i) => (
            <div key={k} title={what} style={{ padding: "4px 16px 4px", borderLeft: i ? "1px solid var(--line)" : undefined, minWidth: 0 }}>
              <div className="label">{String(i + 1).padStart(2, "0")} · {name}</div>
              <div style={{ font: "600 34px/1.1 var(--f-display)", fontStretch: "78%", marginTop: 6, color: k === "promoted" && o.loop.stages[k] ? "var(--signal)" : undefined }} className="num">{o.loop.stages[k]}</div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="cols c3" style={{ marginTop: 16 }}>
        <Panel title="Last live episode" right={L && <Pill v={L.status} />}>
          {L ? (
            <Link to={`/runs/${encodeURIComponent(L.run_id)}/episodes/${encodeURIComponent(L.episode_id)}`} className="stack" style={{ gap: 10 }}>
              <Viewport cam="agentview" step={L.steps} src={lastFrame ? frameUrl(L.run_id, L.episode_id, lastFrame.obs, "agentview") : null} empty="no frame recorded" />
              <div style={{ fontSize: 13 }}>{shortTask(L.task_id)} <span className="faint">· init {L.seed}</span></div>
            </Link>
          ) : <div className="empty-state">No live episode yet. <Link to="/live" className="sig">Run one</Link>.</div>}
        </Panel>

        <Panel title="Strongest gate result" right={best && <Pill v={best.verdict} />}>
          {best ? (
            <Link to={`/campaigns/${encodeURIComponent(best.campaign)}`} className="stack" style={{ gap: 12 }}>
              <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
                <span style={{ font: "600 44px/1 var(--f-display)", fontStretch: "75%", color: "var(--signal)" }} className="num">{best.effect > 0 ? "+" : ""}{Math.round(best.effect * 100)}</span>
                <span className="dim">points on the gate split<br /><span className="num faint">{pct(best.parent_success)} → {pct(best.success)} · {best.wins}/{best.losses} pairs · p {best.p_value?.toExponential(1)}</span></span>
              </div>
              <div className="clamp2" style={{ fontSize: 13 }} title={best.hypothesis}>{best.hypothesis}</div>
              {best.notes?.includes("safety") && <div className="row tight"><span className="hazard" style={{ width: 18, height: 10, borderRadius: 1 }} /><span className="haz" style={{ fontSize: 12.5 }}>vetoed: more safety interventions than the parent</span></div>}
            </Link>
          ) : <div className="empty-state">No candidate has reached the gate yet.</div>}
        </Panel>

        <Panel title="Instruments">
          {cal ? (
            <div className="stack" style={{ gap: 12 }}>
              <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
                <span style={{ font: "600 44px/1 var(--f-display)", fontStretch: "75%" }} className="num">{cal.auc.toFixed(2)}</span>
                <span className="dim">AUC of the success judge<br /><span className="faint num">on {cal.n} unseen-init-state episodes</span></span>
              </div>
              <div className="kv">
                <span>labels at</span><span className="num">{pct(cal.precision)} precision · {pct(cal.recall)} recall</span>
                <span>status</span><span>{cal.ready ? <Pill v="success" label="calibrated" /> : <Pill v="failure" label="not ready" />}</span>
                <span>built from</span><span className="mono">{o.judge.path}</span>
              </div>
            </div>
          ) : <div className="empty-state">No calibrated judge yet.</div>}
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel title="Recent runs" right={<Link to="/runs" className="toggle">all {o.runs} runs →</Link>} flush>
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>run</th><th>split</th><th className="r">episodes</th><th>success</th><th className="r">when</th></tr></thead>
              <tbody>{o.recent.map((r: any) => (
                <tr key={r.run_id} className="click" onClick={() => nav(`/runs/${encodeURIComponent(r.run_id)}`)}>
                  <td><div>{r.name || r.run_id}</div><div className="mono faint" style={{ fontSize: 11.5 }}>{r.group}</div></td>
                  <td><SplitChip split={r.split} /></td><td className="r num">{r.n}</td><td><Meter value={r.success} /></td>
                  <td className="r faint" style={{ fontSize: 12.5 }}>{ago(r.created_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
