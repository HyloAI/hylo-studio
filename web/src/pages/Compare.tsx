// A/B arena: two runs paired on (task, init state). The same statistic the RSI gate uses: an exact one-sided
// McNemar test on the discordant pairs.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { pct, shortTask, useApi } from "../api";
import { EpisodePlayer } from "../components/EpisodePlayer";
import { OutcomeGrid } from "../components/OutcomeGrid";
import { Err, Loading, PageHead, Panel, Pill } from "../components/parts";

function Dumbbell({ rows }: { rows: { task_id: string; a: number; b: number; n: number }[] }) {
  const cols = "minmax(140px, 300px) minmax(0,1fr) 48px";
  return (
    <div className="stack" style={{ gap: 0 }}>
      {rows.map((r) => {
        const lo = Math.min(r.a, r.b), hi = Math.max(r.a, r.b);
        return (
          <div key={r.task_id} style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 12, height: 26 }}>
            <span style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} className="dim" title={r.task_id}>{shortTask(r.task_id)}</span>
            <div style={{ position: "relative", height: 12 }}>
              <i style={{ position: "absolute", left: 0, right: 0, top: 5.5, height: 1, background: "var(--grid)" }} />
              <i style={{ position: "absolute", left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, top: 4.5, height: 3, background: r.b >= r.a ? "var(--signal)" : "var(--trace-a)", opacity: 0.45 }} />
              <i style={{ position: "absolute", left: `calc(${r.a * 100}% - 5px)`, top: 1, width: 10, height: 10, borderRadius: "50%", background: "var(--trace-a)" }} />
              <i style={{ position: "absolute", left: `calc(${r.b * 100}% - 5px)`, top: 1, width: 10, height: 10, borderRadius: "50%", background: "var(--signal)" }} />
            </div>
            <span className={`num ${r.b > r.a ? "sig" : "faint"}`} style={{ fontSize: 12.5, textAlign: "right" }}>{r.b - r.a > 0 ? "+" : ""}{Math.round((r.b - r.a) * 100)}</span>
          </div>
        );
      })}
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, marginTop: 4 }}>
        <span /><div className="scale"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div><span />
      </div>
    </div>
  );
}

export function Compare() {
  const [runs] = useApi<any[]>("/api/runs");
  const [params, setParams] = useSearchParams();
  const a = params.get("a") || "", b = params.get("b") || "";
  const [cmp, err] = useApi<any>(a && b ? `/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : null);
  const [pair, setPair] = useState<any>(null);
  useEffect(() => setPair(null), [a, b]);

  const pick = (k: "a" | "b", v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p); };
  const opts = (runs || []).filter((r) => r.n > 1);
  const label = (r: any) => `${r.name || r.run_id} · ${r.split} · ${pct(r.success)} · ${r.group}`;
  const m = useMemo(() => {
    if (!cmp) return null;
    const c = { both: 0, onlyA: 0, onlyB: 0, none: 0 };
    for (const p of cmp.pairs) { if (p.a && p.b) c.both++; else if (p.a) c.onlyA++; else if (p.b) c.onlyB++; else c.none++; }
    return c;
  }, [cmp]);
  const cells = (cmp?.pairs || []).map((p: any) => ({
    key: p.key, task_id: p.task_id, seed: p.seed,
    cls: p.a && p.b ? "both" : p.b ? "onlyb" : p.a ? "onlya" : "none",
    title: `${shortTask(p.task_id)} · init ${p.seed} · A ${p.a ? "success" : "failure"} · B ${p.b ? "success" : "failure"}`,
  }));
  const delta = cmp ? (cmp.b.success - cmp.a.success) * 100 : 0;

  return (
    <>
      <PageHead title="A/B arena" />
      <div className="cols c2">
        {(["a", "b"] as const).map((k) => (
          <label key={k} className="field">
            <span className="label row tight"><i className="sw" style={{ background: k === "a" ? "var(--trace-a)" : "var(--signal)" }} />{k === "a" ? "A · baseline" : "B · candidate"}</span>
            <select id={`run-${k}`} value={k === "a" ? a : b} onChange={(e) => pick(k, e.target.value)}>
              <option value="">Choose a run…</option>
              {opts.map((r) => <option key={r.run_id} value={r.run_id}>{label(r)}</option>)}
            </select>
          </label>
        ))}
      </div>
      {err && <div style={{ marginTop: 14 }}><Err e={err} /></div>}
      {!(a && b) && <div className="empty-state">Choose two runs of the same split.</div>}
      {a && b && !cmp && !err && <Loading what="comparison" />}
      {cmp && m && (
        <div className="stack" style={{ marginTop: 18 }}>
          <div className="cols" style={{ gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)" }}>
            <Panel title="Result">
              <div className="row" style={{ alignItems: "flex-end", gap: 26 }}>
                <div>
                  <div className="label">B − A</div>
                  <div className="num" style={{ font: "600 56px/1 var(--f-display)", fontStretch: "75%", color: delta > 0 ? "var(--signal)" : delta < 0 ? "var(--trace-a)" : undefined }}>{delta > 0 ? "+" : ""}{delta.toFixed(0)}<span style={{ fontSize: 20 }} className="faint"> pts</span></div>
                </div>
                <div className="kv" style={{ paddingBottom: 6 }}>
                  <span>A</span><span className="num">{pct(cmp.a.success, 1)} <span className="faint">· {cmp.a.name}</span></span>
                  <span>B</span><span className="num">{pct(cmp.b.success, 1)} <span className="faint">· {cmp.b.name}</span></span>
                  <span>one-sided p</span><span className="num">{cmp.paired.n_pairs ? (cmp.paired.p_value < 0.001 ? cmp.paired.p_value.toExponential(1) : cmp.paired.p_value.toFixed(3)) : "no common pairs"}</span>
                </div>
              </div>
            </Panel>
            <Panel title={`Paired outcomes · ${cmp.paired.n_pairs} pairs`}>
              <table className="tbl" style={{ textAlign: "center" }}>
                <thead><tr><th></th><th className="r">B succeeds</th><th className="r">B fails</th></tr></thead>
                <tbody>
                  <tr><td className="label">A succeeds</td><td className="r num" style={{ fontSize: 20 }}>{m.both}</td><td className="r num" style={{ fontSize: 20, color: "var(--trace-a)" }}>{m.onlyA}</td></tr>
                  <tr><td className="label">A fails</td><td className="r num" style={{ fontSize: 20, color: "var(--signal)" }}>{m.onlyB}</td><td className="r num faint" style={{ fontSize: 20 }}>{m.none}</td></tr>
                </tbody>
              </table>
            </Panel>
          </div>
          <Panel title="Per task · A → B">
            <Dumbbell rows={cmp.per_task} />
          </Panel>
          <Panel title="Every pair · task × init state" right={<span className="row tight faint" style={{ fontSize: 12 }}>
            <i className="sw" style={{ background: "var(--signal)" }} />only B<i className="sw" style={{ background: "var(--trace-a)", marginLeft: 8 }} />only A
            <i className="sw" style={{ background: "var(--ink-3)", opacity: 0.5, marginLeft: 8 }} />both<i className="sw" style={{ background: "var(--raised)", marginLeft: 8, border: "1px solid var(--line-2)" }} />neither</span>}>
            <OutcomeGrid cells={cells} current={pair?.key} onPick={(c) => setPair(cmp.pairs.find((p: any) => p.key === c.key))} />
          </Panel>
          {pair && (
            <Panel title={`${shortTask(pair.task_id)} · init ${pair.seed}`}>
              <div className="cols c2">
                <div className="stack" style={{ gap: 8 }}><div className="row tight"><i className="sw" style={{ background: "var(--trace-a)" }} /><span className="label">A</span><Pill v={pair.a ? "success" : "failure"} /></div>
                  <EpisodePlayer compact runId={a} episodeId={pair.episode_a} /></div>
                <div className="stack" style={{ gap: 8 }}><div className="row tight"><i className="sw" style={{ background: "var(--signal)" }} /><span className="label">B</span><Pill v={pair.b ? "success" : "failure"} /></div>
                  <EpisodePlayer compact runId={b} episodeId={pair.episode_b} /></div>
              </div>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
