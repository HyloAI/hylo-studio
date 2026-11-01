// Replay of one recorded episode: camera viewports with a transport bar, the step timeline (policy calls as ticks,
// safety interventions as hazard diamonds), executed-action traces and the success judge's estimate.
import { useEffect, useMemo, useState } from "react";
import { frameUrl, shortTask, useApi } from "../api";
import { Icon } from "./icons";
import { Loading, Err, Pill } from "./parts";
import { Timeline, Traces, Viewport } from "./Telemetry";

export function EpisodePlayer({ runId, episodeId, compact = false }: { runId: string; episodeId: string; compact?: boolean }) {
  const base = `/api/runs/${encodeURIComponent(runId)}/episodes/${encodeURIComponent(episodeId)}`;
  const [tl, err] = useApi<any>(base);
  const [judge] = useApi<any>(compact ? null : `${base}/judge`);
  const [fi, setFi] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => { setFi(0); setPlaying(false); }, [runId, episodeId]);
  useEffect(() => {
    if (!playing || !tl) return;
    const id = setInterval(() => setFi((i) => (i + 1 < tl.frames.length ? i + 1 : (setPlaying(false), i))), 200);
    return () => clearInterval(id);
  }, [playing, tl]);

  const chunks = useMemo(() => (tl ? tl.chunks.map((c: any) => c.step) : []), [tl]);
  if (err) return <Err e={err} />;
  if (!tl) return <Loading what="episode" />;
  const fr = tl.frames[fi];
  const step = fr ? fr.step : tl.steps;
  const seek = (s: number) => {
    let best = 0;
    tl.frames.forEach((f: any, i: number) => { if (Math.abs(f.step - s) < Math.abs(tl.frames[best].step - s)) best = i; });
    setFi(best);
  };
  const cams: string[] = fr ? fr.cameras : (tl.cameras.length ? tl.cameras : []);
  const judgePts = judge?.progress ? { name: judge.judge.replace(/@.*/, ""), pts: judge.progress.map((p: number, i: number) => [tl.frames[i]?.step ?? i, p] as [number, number]) } : null;
  const end = tl.end || {};

  const player = (
    <div className="stack" style={{ gap: 12 }}>
      <div className="views">
        {cams.length ? cams.map((c) => <Viewport key={c} cam={c} step={step} maxSteps={tl.steps} src={fr ? frameUrl(runId, episodeId, fr.obs, c) : null} />)
          : <Viewport cam="no camera" empty={<>this environment records no camera frames<br />state and actions are below</>} />}
      </div>
      {tl.frames.length > 0 && (
        <div className="row tight">
          <button className="btn" onClick={() => setFi(Math.max(0, fi - 1))} aria-label="previous frame"><Icon.back /></button>
          <button className="btn go" onClick={() => { if (fi >= tl.frames.length - 1) setFi(0); setPlaying(!playing); }} aria-label={playing ? "pause" : "play"}>
            {playing ? <Icon.pause /> : <Icon.play />}</button>
          <button className="btn" onClick={() => setFi(Math.min(tl.frames.length - 1, fi + 1))} aria-label="next frame"><Icon.fwd /></button>
          <span className="grow" />
          <span className="num dim" style={{ fontSize: 12 }}>frame {fi + 1}/{tl.frames.length} · recorded every {tl.frames[1] ? tl.frames[1].step - tl.frames[0].step : 1} steps</span>
        </div>
      )}
      <Timeline max={tl.steps} done={tl.steps} cursor={step} chunks={chunks} onSeek={seek}
        safety={tl.safety.map((s: any) => ({ step: s.step, title: `${(s.reasons || []).join(", ")} Δ${s.max_change}` }))} />
      <Traces actions={tl.actions} xMax={tl.steps} cursor={step} chunks={chunks} onSeek={seek} judge={judgePts} compact={compact} />
    </div>
  );
  if (compact) return player;

  return (
    <div className="cols side">
      <div className="panel"><div className="pb">{player}</div></div>
      <div className="stack">
        <div className="panel">
          <div className="ph"><span className="label">Episode</span><span className="grow" /><Pill v={end.status} /></div>
          <div className="pb stack" style={{ gap: 14 }}>
            {tl.instruction && <div className="quote">{tl.instruction}</div>}
            <div className="kv">
              <span>task</span><span>{shortTask(tl.start.task_id)}</span>
              <span>init state</span><span className="num">{tl.start.seed}</span>
              <span>split</span><span>{tl.start.split}</span>
              <span>steps</span><span className="num">{tl.steps} · {end.termination_reason}</span>
              <span>policy calls</span><span className="num">{tl.chunks.length}</span>
              <span>safety</span><span className={tl.safety.length ? "haz num" : "num"}>{tl.safety.length} interventions</span>
              <span>agent</span><span className="mono">{tl.start.agent}</span>
              {Object.entries(tl.start.agent_components || {}).map(([k, v]) => [<span key={k}>{k}</span>, <span key={k + "v"} className="mono">{String(v)}</span>])}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="ph"><span className="label">Event log</span></div>
          <div className="pb console">
            {[
              ...tl.chunks.map((c: any) => ({ s: c.step, k: "", t: `policy call · ${c.latency_s}s · runs ${c.execution_steps} steps${c.provenance?.n_samples > 1 ? ` · best of ${c.provenance.n_samples}` : ""}` })),
              ...tl.safety.map((s: any) => ({ s: s.step, k: "w", t: `safety: ${(s.reasons || []).join(", ")} · Δ ${s.max_change}` })),
              ...tl.memory.map((m: any) => ({ s: m.step, k: "", t: `memory retrieval${m.t0 !== undefined ? ` · t0 ${m.t0}` : ""}` })),
              ...tl.skills.map((m: any) => ({ s: m.step, k: "", t: `skill applied · ${m.skill || m.id || ""}` })),
              { s: tl.steps, k: end.status === "success" ? "" : "e", t: `episode end · ${end.status}` },
            ].sort((a, b) => a.s - b.s).map((e, i) => <div key={i}><span className="t">{e.s}</span><span className={e.k}>{e.t}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
