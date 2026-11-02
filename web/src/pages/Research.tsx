// Research sessions and code-agent runs: a model writes and runs code turn by turn; its submissions are scored on
// development cases and the best one is frozen into a sealed program. Read straight from the session directories.
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ago, dur, kTok, sessionFileUrl, usd, useApi } from "../api";
import { Code } from "../components/Code";
import { Err, Figs, Loading, PageHead, Panel, Pill, Reveal, Seg } from "../components/parts";

const KIND: Record<string, string> = { research: "research", scene: "scene builder", motion: "motion studio", replay: "replay" };

function Score({ s }: { s?: { successes: number | null; cases: number | null } | null }) {
  if (!s || s.successes === null || s.successes === undefined || !s.cases) return <span className="faint">–</span>;
  const v = s.successes / s.cases;
  return (
    <span className={`meter ${v === 1 ? "ok" : ""}`}>
      <span className="t" style={{ width: 54 }}><i style={{ width: `${v * 100}%` }} /></span>
      <span className="n" style={{ width: "auto" }}>{s.successes}/{s.cases}</span>
    </span>
  );
}

export function Research() {
  const [rows, err] = useApi<any[]>("/api/research/sessions");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const shown = useMemo(() => (rows || []).filter((r) => (kind === "all" || KIND[r.kind] === kind)
    && (!q || `${r.id} ${r.model} ${r.task} ${r.stopped}`.toLowerCase().includes(q.toLowerCase()))), [rows, kind, q]);
  if (err) return <Err e={err} />;
  if (!rows) return <Loading what="sessions" />;
  const kinds = ["all", ...Object.keys(KIND).filter((k) => rows.some((r) => r.kind === k)).map((k) => KIND[k])];
  return (
    <>
      <PageHead title="Research">A model develops a program turn by turn: it writes code, runs it on the robot, looks at the result and
        submits programs that are scored on development cases. The best submission is frozen into a sealed program.</PageHead>
      <div className="row" style={{ marginBottom: 14 }}>
        {kinds.length > 2 && <Seg value={kind} options={kinds} onChange={setKind} />}
        <input id="rq" placeholder="Filter by session, model, task or stop reason" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 340 }} />
        <span className="faint num" style={{ fontSize: 12.5 }}>{shown.length} sessions</span>
      </div>
      <Panel flush>
        <div className="scroll-x">
          <table className="tbl snug">
            <thead><tr><th>session</th><th>task · model</th><th>dev score</th><th className="r">turns</th>
              <th className="r">tokens in/out</th><th className="r">cost</th><th className="r">wall</th><th>stopped</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`/research/${encodeURIComponent(r.id)}`)}>
                <td>
                  <div className="row tight" style={{ flexWrap: "nowrap", maxWidth: 225 }}><span className="ell">{r.session || r.name}</span>{r.kind !== "research" && <span className="chip">{KIND[r.kind]}</span>}</div>
                  <div className="mono faint ell" style={{ fontSize: 11.5, maxWidth: 225 }} title={r.id}>{r.id}</div>
                </td>
                <td>
                  <div className="ell dim" style={{ fontSize: 13, maxWidth: 245 }} title={r.task}>{r.task || "–"}</div>
                  <div className="mono faint ell" style={{ fontSize: 11.5, maxWidth: 245 }}>{r.model || "–"}</div>
                </td>
                <td><Score s={r.score} /></td>
                <td className="r num">{r.turns ?? "–"}{r.budget?.turns ? <span className="faint">/{r.budget.turns}</span> : null}</td>
                <td className="r num" style={{ whiteSpace: "nowrap" }}>{kTok(r.usage?.tokens_in)} <span className="faint">/</span> {kTok(r.usage?.tokens_out)}</td>
                <td className="r num">{usd(r.usage?.cost_usd)}</td>
                <td className="r num" style={{ whiteSpace: "nowrap" }}>{dur(r.wall_s)}</td>
                <td>
                  <div className={`ell ${/error|interrupt/.test(r.stopped || "") ? "haz" : "dim"}`} style={{ fontSize: 12.5, maxWidth: 170 }} title={r.stopped}>{r.stopped || "–"}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{r.started ? ago(r.started) : ""}</div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {!shown.length && <div className="empty-state">No research sessions under the runs directory{rows.length ? " match the filter" : ""}.</div>}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- usage chart
// Two small single-measure charts on their own axes (tokens, latency): one bar per turn; submissions marked below.
function Bars({ turns, value, part, max, fmt, hover, setHover, onPick, marks, label }: {
  turns: any[]; value: (t: any) => number; part?: (t: any) => number; max: number; fmt: (v: number) => string;
  hover: number | null; setHover: (i: number | null) => void; onPick: (t: any) => void; marks: Set<number>; label: string;
}) {
  const n = Math.max(turns.length, 12);         // few turns: narrow bars from the left, not a few slabs
  const W = 600, H = 92, top = 6, base = 74;
  const bw = W / n;
  const y = (v: number) => base - (max ? (v / max) * (base - top) : 0);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: "space-between" }}><span className="label">{label}</span><span className="faint num" style={{ fontSize: 11 }}>max {fmt(max)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="bars" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} stroke="var(--line-2)" strokeWidth={1} />
        {turns.map((t, i) => {
          const v = value(t), p = part ? Math.min(part(t), v) : 0;
          const x = i * bw + Math.min(2, bw * 0.15), w = Math.max(bw - 2 * Math.min(2, bw * 0.15), 1);
          const on = hover === i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onClick={() => onPick(t)} style={{ cursor: "pointer" }}>
              <rect x={i * bw} y={0} width={bw} height={H} fill={on ? "var(--raised)" : "transparent"} />
              {v > 0 && <rect x={x} y={y(v)} width={w} height={base - y(v)} rx={Math.min(2, w / 2)} fill={on ? "var(--signal)" : "var(--ink-2)"} />}
              {p > 0 && <rect x={x} y={y(p)} width={w} height={base - y(p)} fill={on ? "var(--signal)" : "var(--ink-3)"} opacity={0.55} />}
              {marks.has(t.turn) && <path d={`M${i * bw + bw / 2 - 4} ${H - 2} l4 -7 l4 7 Z`} fill="var(--signal)" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Usage({ s, onPick }: { s: any; onPick: (turn: number) => void }) {
  const turns = s.events.filter((e: any) => e.kind === "turn");
  const [hover, setHover] = useState<number | null>(null);
  const marks = useMemo(() => {
    // a submission record is written while the turn that called submit() runs: mark that turn
    const m = new Set<number>();
    s.events.forEach((e: any, i: number) => {
      if (e.kind !== "submit") return;
      const next = s.events.slice(i + 1).find((x: any) => x.kind === "turn");
      if (next) m.add(next.turn);
    });
    return m;
  }, [s]);
  if (!turns.length) return null;
  const u = s.usage || {};
  const sum = (k: string) => turns.reduce((a: number, t: any) => a + (typeof t[k] === "number" ? t[k] : 0), 0);
  const maxIn = Math.max(...turns.map((t: any) => t.tokens_in || 0));
  const maxLat = Math.max(...turns.map((t: any) => t.latency_s || 0));
  const h = hover !== null ? turns[hover] : null;
  const pick = (t: any) => onPick(t.turn);
  return (
    <Panel title="Cost and usage" right={<span className="row tight faint" style={{ fontSize: 12 }}>
      <i className="sw" style={{ background: "var(--ink-2)" }} />prompt tokens<i className="sw" style={{ background: "var(--ink-3)", opacity: 0.55, marginLeft: 8 }} />of them cached
      <svg width="10" height="9" style={{ marginLeft: 8 }}><path d="M1 8 l4 -7 l4 7 Z" fill="var(--signal)" /></svg>submission</span>}>
      <div className="usage">
        <div className="stack" style={{ gap: 12 }}>
          <div className="cols c2">
            <Bars turns={turns} value={(t) => t.tokens_in || 0} part={(t) => t.cached_tokens || 0} max={maxIn} fmt={kTok}
              hover={hover} setHover={setHover} onPick={pick} marks={marks} label="prompt tokens per turn" />
            <Bars turns={turns} value={(t) => t.latency_s || 0} max={maxLat} fmt={(v) => `${v.toFixed(0)} s`}
              hover={hover} setHover={setHover} onPick={pick} marks={marks} label="model latency per turn" />
          </div>
          <div className="readout num">
            {h ? <>turn <b>{h.turn}</b> · {(h.tokens_in ?? 0).toLocaleString()} in{h.cached_tokens ? ` (${h.cached_tokens.toLocaleString()} cached)` : ""} · {(h.tokens_out ?? 0).toLocaleString()} out
              · model {dur(h.latency_s)} · code {dur(h.exec_s)}{h.error ? " · error" : ""}{marks.has(h.turn) ? " · submitted" : ""}</>
              : <span className="faint">Hover a bar for one turn; click it to open the turn in the timeline.</span>}
          </div>
        </div>
        <div className="kv">
          <span>model calls</span><span className="num">{u.calls ?? turns.length}</span>
          <span>tokens in</span><span className="num">{(u.tokens_in ?? sum("tokens_in")).toLocaleString()}</span>
          <span>cached</span><span className="num">{sum("cached_tokens").toLocaleString()}</span>
          <span>tokens out</span><span className="num">{(u.tokens_out ?? sum("tokens_out")).toLocaleString()}</span>
          <span>cost</span><span className="num">{usd(u.cost_usd)}{u.cost_usd === 0 ? <span className="faint"> (local model)</span> : null}</span>
          <span>model time</span><span className="num">{dur(u.latency_s ?? sum("latency_s"))}</span>
          <span>code time</span><span className="num">{dur(sum("exec_s"))}</span>
          <span>per turn</span><span className="num">{dur((u.latency_s ?? sum("latency_s")) / turns.length)} · {kTok((u.tokens_in ?? sum("tokens_in")) / turns.length)} in</span>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------- timeline
function Images({ id, images }: { id: string; images: any[] }) {
  return (
    <div className="shots">
      {images.map((im, i) => im.file ? (
        <figure key={i}>
          <a href={sessionFileUrl(id, im.file)} target="_blank" rel="noreferrer"><img src={sessionFileUrl(id, im.file)} alt={im.note} loading="lazy" /></a>
          <figcaption>{im.note}</figcaption>
        </figure>
      ) : (
        <figure key={i} className="missing"><div>{im.shape ? `${im.shape[1]}×${im.shape[0]} image` : "image"} not saved with the run</div><figcaption>{im.note}</figcaption></figure>
      ))}
    </div>
  );
}

function Outcomes({ outcomes }: { outcomes: any[] }) {
  return (
    <div className="row tight">
      {outcomes.map((o: any, i: number) => (
        <span key={i} className={`pill ${o.success ? "ok" : o.success === false ? "bad" : "haz"}`} title={o.reason || ""}>
          case {o.case} · {o.success ? "success" : o.success === false ? "failure" : o.status || "no verdict"}{o.steps ? ` · ${o.steps} steps` : ""}
        </span>
      ))}
    </div>
  );
}

function Turn({ id, e }: { id: string; e: any }) {
  const where = e.live_case !== undefined && e.live_case !== null ? `case ${e.live_case}` : e.step !== undefined ? `step ${e.step}` : null;
  return (
    <article className="turn" id={`turn-${e.turn}`}>
      <div className="turn-h">
        <span className="tno">{e.turn}</span>
        <span className="label" style={{ color: "var(--ink-2)" }}>turn {e.turn}</span>
        {where && <span className="chip">{where}</span>}
        {e.error && <Pill v="failure" label="error" />}
        {e.timed_out && <Pill v="error" label="timed out" />}
        {e.model_error && <Pill v="error" label="model error" />}
        <span className="grow" />
        <span className="faint num" style={{ fontSize: 11.5 }}>
          {e.latency_s !== undefined && <>model {dur(e.latency_s)}</>}
          {e.tokens_in !== undefined && <> · {kTok(e.tokens_in)} in{e.cached_tokens ? ` (${kTok(e.cached_tokens)} cached)` : ""} · {kTok(e.tokens_out)} out</>}
          {e.exec_s ? <> · code {dur(e.exec_s)}</> : null}
        </span>
      </div>
      <div className="turn-b">
        {e.prompt && (
          <Reveal label="what the model was shown first">
            {e.prompt.system && <pre className="prose-pre">{e.prompt.system}</pre>}
            {e.prompt.first && <pre className="prose-pre">{e.prompt.first}</pre>}
          </Reveal>
        )}
        {e.reasoning && <Reveal label="reasoning"><div className="reasoning">{e.reasoning}</div></Reveal>}
        {e.text && <div className="say">{e.text}</div>}
        {e.code && <div className="stack" style={{ gap: 4 }}><span className="label">code{e.blocks > 1 ? ` · ${e.blocks} blocks` : ""}</span><Code src={e.code} max={460} /></div>}
        {e.output && <div className="stack" style={{ gap: 4 }}><span className="label">output</span><pre className="terminal out">{e.output}</pre></div>}
        {e.error && <div className="stack" style={{ gap: 4 }}><span className="label">error</span><pre className="terminal out bad-out">{e.error}</pre></div>}
        {e.model_error && <pre className="terminal out bad-out">{e.model_error}</pre>}
        {e.images && <Images id={id} images={e.images} />}
      </div>
    </article>
  );
}

function Event({ id, e }: { id: string; e: any }) {
  if (e.kind === "turn") return <Turn id={id} e={e} />;
  if (e.kind === "submit") return (
    <div className="ev submit">
      <div className="row"><b>Submission {e.submission}</b><span className="dim">{e.successes} of {e.cases} development cases solved</span>
        <span className="grow" />{e.run_id && <span className="mono faint" style={{ fontSize: 11.5 }}>{e.run_id}</span>}</div>
      <Outcomes outcomes={e.results || []} />
    </div>
  );
  if (e.kind === "reset") return (
    <div className="ev"><span className="label">reset</span> <span className="dim">case {e.outcome?.case} ended: {e.outcome?.success ? "success" : e.outcome?.success === false ? "failure" : "no verdict"}
      {e.outcome?.steps ? `, ${e.outcome.steps} steps` : ""} ({e.outcome?.reason}); next: case {e.next_case}</span></div>
  );
  if (e.kind === "tool") return (
    <div className="ev"><div className="row tight"><span className="label">tool</span><b className="mono" style={{ fontSize: 12.5 }}>{e.tool}</b>
      {e.seconds !== undefined && <span className="faint num" style={{ fontSize: 11.5 }}>{dur(e.seconds)}</span>}{e.error && <Pill v="failure" label="error" />}</div>
      <div className="mono dim wrap-any" style={{ fontSize: 12, marginTop: 4 }}>{Object.entries(e.args || {}).map(([k, v]) => `${k}=${v}`).join(", ")}</div>
      {(e.result || e.error) && <div className={`mono wrap-any clamp2 ${e.error ? "bad" : "faint"}`} style={{ fontSize: 12 }} title={String(e.result || e.error)}>→ {String(e.error || e.result)}</div>}
    </div>
  );
  if (e.kind === "parent") return (
    <div className="ev"><span className="label">starting program</span> <span className="dim">{e.defined ? "the parent program was loaded into the namespace" : "no parent program"}{e.error ? `: ${e.error}` : ""}</span></div>
  );
  if (e.kind === "start") return (
    <div className="ev"><span className="label">start</span> <span className="dim">{e.request}{e.robot ? ` · robot ${e.robot}` : ""}</span></div>
  );
  if (e.kind === "end") return (
    <div className="ev"><span className="label">end</span> <span className="dim">{e.stopped}{e.frozen?.digest ? ` · froze submission ${e.frozen.submission} (digest ${e.frozen.digest})` : e.frozen === null ? " · nothing frozen" : ""}</span></div>
  );
  return <div className="ev"><span className="label">{e.kind}</span> <span className="mono faint" style={{ fontSize: 12 }}>{JSON.stringify(e).slice(0, 300)}</span></div>;
}

// ---------------------------------------------------------------------------------------------- submissions, program
function SourceFile({ id, path }: { id: string; path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(sessionFileUrl(id, path)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText)))).then(setSrc).catch((e) => setErr(String(e.message || e)));
  }, [id, path]);
  if (err) return <div className="err">{err}</div>;
  if (src === null) return <div className="faint">Loading {path}…</div>;
  return <Code src={src} max={520} />;
}

function Submissions({ s }: { s: any }) {
  const cases = s.dev_cases || [];
  return (
    <div className="stack">
      {cases.length > 0 && (
        <Panel title={`Development cases · ${cases.length}`}>
          <div className="kv">{cases.map((c: any) => [<span key={`k${c.case}`}>case {c.case}</span>, <span key={`v${c.case}`}>{c.instruction}<span className="mono faint" style={{ fontSize: 11.5 }}> · {c.key}</span></span>])}</div>
        </Panel>
      )}
      {!s.submissions.length && <div className="empty-state">Nothing was submitted in this session.</div>}
      {s.submissions.map((sub: any) => (
        <Panel key={sub.submission} title={`Submission ${sub.submission}`} right={<>{sub.frozen && <Pill v="promoted" label="frozen" />}<Score s={sub} /></>}>
          <div className="stack" style={{ gap: 10 }}>
            <table className="tbl inner">
              <thead><tr><th>case</th><th>outcome</th><th className="r">steps</th><th>reason</th><th>printed output</th></tr></thead>
              <tbody>{(sub.outcomes || []).map((o: any) => (
                <tr key={o.case}>
                  <td className="num">{o.case}</td>
                  <td><Pill v={o.success ? "success" : o.success === false ? "failure" : "error"} label={o.success ? "success" : o.success === false ? "failure" : o.status || "no verdict"} /></td>
                  <td className="r num">{o.steps ?? "–"}</td>
                  <td className="dim" style={{ fontSize: 12.5 }}>{o.reason || "–"}{o.error ? <div className="bad mono" style={{ fontSize: 11.5 }}>{o.error}</div> : null}</td>
                  <td style={{ maxWidth: 420 }}>{o.output ? <div className="mono faint clamp2" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }} title={o.output}>{o.output}</div> : <span className="faint">–</span>}</td>
                </tr>
              ))}</tbody>
            </table>
            {sub.source && <Reveal label={`source · ${sub.source}`}><SourceFile id={s.id} path={sub.source} /></Reveal>}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Frozen({ s }: { s: any }) {
  if (!s.frozen.length) return <div className="empty-state">No program was frozen in this session.</div>;
  return (
    <div className="stack">
      {s.frozen.map((f: any) => {
        const prov = f.artifact?.provenance || {};
        return (
          <div key={f.name} className="cols side">
            <Panel title={`${f.program?.file || "solve.py"} · ${f.lines} lines`} right={<a className="toggle" href={sessionFileUrl(s.id, f.file)} target="_blank" rel="noreferrer">raw file</a>} flush>
              {f.source ? <Code src={f.source} max={640} /> : <div className="empty-state">The source file is missing.</div>}
            </Panel>
            <Panel title="Sealed program">
              <div className="kv">
                <span>name</span><span className="mono">{f.name}</span>
                <span>digest</span><span className="mono sig">{f.digest || "–"}</span>
                <span>entry</span><span className="mono">{f.program?.entry}({f.program?.entry === "solve" ? "robot" : ""})</span>
                <span>submission</span><span className="num">{f.submission ?? "–"}</span>
                <span>dev result</span><span className="num">{f.artifact?.metrics ? `${f.artifact.metrics.dev_successes}/${f.artifact.metrics.dev_cases}` : "–"}</span>
                <span>family</span><span>{f.program?.family || "–"}</span>
                <span>tasks</span><span className="mono">{(f.program?.tasks || []).join(", ") || "–"}</span>
                <span>model</span><span className="mono">{f.program?.model || prov.params?.model || "–"}</span>
                <span>built by</span><span className="mono">{prov.builder || "–"}</span>
                <span>data splits</span><span>{(prov.sources || []).map((x: any) => x.split).filter(Boolean).join(", ") || "–"}</span>
                <span>mutable</span><span>{f.artifact?.mutable === false ? "no (sealed)" : String(f.artifact?.mutable ?? "–")}</span>
                {prov.created_at && <><span>sealed</span><span>{new Date(prov.created_at * 1000).toLocaleString()}</span></>}
              </div>
              {f.program?.description && <p className="dim" style={{ fontSize: 13, marginBottom: 0 }}>{f.program.description}</p>}
            </Panel>
          </div>
        );
      })}
    </div>
  );
}

function Videos({ s }: { s: any }) {
  const res = s.kind === "replay" && s.summary && typeof s.summary === "object" && !Array.isArray(s.summary) ? s.summary : null;
  return (
    <div className="views" style={{ gridTemplateColumns: s.videos.length === 1 ? "minmax(0, 720px)" : "repeat(auto-fill, minmax(320px, 1fr))" }}>
      {s.videos.map((v: string) => {
        const meta = res?.[v.replace(/\.(mp4|webm)$/, "")];
        return (
          <figure key={v} className="vid">
            <video src={sessionFileUrl(s.id, v)} controls muted loop playsInline preload="metadata" />
            <figcaption><span className="mono">{v}</span>{meta?.instruction && <span className="dim"> · {meta.instruction}</span>}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function Summary({ s }: { s: any }) {
  return (
    <div className="cols c2">
      <Panel title="Summary file"><pre className="json" style={{ maxHeight: 560 }}>{JSON.stringify(s.summary, null, 2) ?? "no summary file"}</pre></Panel>
      <div className="stack">
        {Object.entries(s.extra || {}).filter(([, v]) => JSON.stringify(v) !== JSON.stringify(s.summary)).map(([k, v]) => (
          <Panel key={k} title={k}><pre className="json">{JSON.stringify(v, null, 2)}</pre></Panel>
        ))}
        <Panel title="Files">
          <div className="stack" style={{ gap: 4 }}>
            <span className="mono faint wrap-any" style={{ fontSize: 11.5 }}>{s.dir}</span>
            {s.files.map((f: string) => <a key={f} className="mono sig" style={{ fontSize: 12.5 }} href={sessionFileUrl(s.id, f)} target="_blank" rel="noreferrer">{f}</a>)}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- session page
export function ResearchSession() {
  const { id = "" } = useParams();
  const [s, err] = useApi<any>(`/api/research/session?id=${encodeURIComponent(id)}`);
  const [tab, setTab] = useState("timeline");
  const [want, setWant] = useState<number | null>(null);
  useEffect(() => {
    if (want === null || tab !== "timeline") return;
    document.getElementById(`turn-${want}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setWant(null);
  }, [want, tab]);
  if (err) return <Err e={err} />;
  if (!s) return <Loading what="session" />;
  const u = s.usage || {};
  const nTurns = s.events.filter((e: any) => e.kind === "turn").length;
  const tabs: [string, ReactNode][] = [["timeline", `Timeline · ${nTurns} turns`]];
  if (s.kind === "research") tabs.push(["submissions", `Submissions · ${s.submissions.length}`], ["program", `Frozen program${s.frozen.length ? "" : " · none"}`]);
  if (s.videos.length) tabs.push(["video", `Video · ${s.videos.length}`]);
  tabs.push(["summary", "Summary and files"]);
  const title = s.session || s.name;
  return (
    <>
      <PageHead crumbs={[["Research", "/research"], [s.id]]} title={title}
        aside={<span className="chip">{KIND[s.kind]}</span>}>
        {s.task || ""}{s.benchmark ? <span className="mono faint" style={{ fontSize: 12 }}> · {s.benchmark}</span> : null}
      </PageHead>
      <Figs items={[
        ...(s.score ? [{ label: s.kind === "research" ? "best dev score" : "result", value: s.score.successes === null ? "–" : <>{s.score.successes}<small>/ {s.score.cases}</small></>,
          sub: s.kind === "research" ? `${s.submissions.length} submissions` : undefined }] : []),
        { label: "turns", value: <>{s.turns ?? nTurns}{s.budget?.turns ? <small>/ {s.budget.turns}</small> : null}</>, sub: s.model },
        { label: "tokens in / out", value: <>{kTok(u.tokens_in)}<small>/ {kTok(u.tokens_out)}</small></>, sub: `${u.calls ?? nTurns} model calls` },
        { label: "cost", value: usd(u.cost_usd), sub: u.cost_usd === 0 ? "local model" : undefined },
        { label: "model time", value: dur(u.latency_s) },
        { label: "wall clock", value: dur(s.wall_s) },
        { label: "stopped", value: <span style={{ fontSize: 15 }}>{s.stopped || "–"}</span> },
      ]} />

      {s.campaigns.map((c: any) => (
        <div key={`${c.campaign}-${c.candidate}`} className="panel linkbar">
          <span className="label">campaign candidate</span>
          <span>The frozen program is candidate <b className="mono">{c.candidate}</b> of <b>{c.name || c.campaign}</b></span>
          {c.verdict && <Pill v={c.verdict} />}
          {c.active && <Pill v="done" label="active version" />}
          <span className="grow" />
          <Link className="toggle sig" style={{ fontWeight: 500 }} to={`/campaigns/${encodeURIComponent(c.campaign)}`}>open the campaign →</Link>
        </div>
      ))}

      <div style={{ marginTop: 16 }}><Usage s={s} onPick={(t) => { setTab("timeline"); setWant(t); }} /></div>

      <div className="tabs" style={{ marginTop: 18 }}>
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "timeline" && (
        <div className="timeline">
          {s.events.length ? s.events.map((e: any, i: number) => <Event key={i} id={s.id} e={e} />) : <div className="empty-state">No turns were recorded.</div>}
        </div>
      )}
      {tab === "submissions" && <Submissions s={s} />}
      {tab === "program" && <Frozen s={s} />}
      {tab === "video" && <Videos s={s} />}
      {tab === "summary" && <Summary s={s} />}
    </>
  );
}
