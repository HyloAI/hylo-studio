import { Fragment, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post, useApi } from "../api";
import { Err, Loading } from "../components/parts";
import "./world-studio.css";

type Entity = { id: string; kind: string; pack?: string; pos?: number[]; shape?: { type: string; size: number[] } };
type Camera = { azimuth: number; elevation: number; distance: number; lx: number; ly: number; lz: number };
type Event = { n: number; type: string; text?: string; message?: string; name?: string; kind?: string; result?: string; ok?: boolean; image?: string; calls?: number; model?: string };
const INITIAL: Camera = { azimuth: 135, elevation: -32, distance: 4, lx: 0, ly: 0, lz: .7 };
const pretty = (s: string) => s.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const token = new URLSearchParams(window.location.search).get("token") || localStorage.getItem("hylo-token") || "";
const auth = (p: string) => token ? p + (p.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) : p;

function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    spark: <><path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z" /><path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7L20 2Z" /></>,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    focus: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><circle cx="12" cy="12" r="3" /></>,
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    camera: <><path d="M4 7h4l2-3h4l2 3h4v13H4V7Z" /><circle cx="12" cy="13" r="3.5" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    sliders: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2.5" fill="currentColor" /><circle cx="15" cy="17" r="2.5" fill="currentColor" /></>,
    robot: <><path d="M4 21h16M8 21v-4h8v4M12 17V9l6-4" /><circle cx="12" cy="7" r="2" /><path d="m17 3 4 4M20 6l-2 3" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3v.1" /></>,
    back: <path d="m14 6-6 6 6 6" />,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.cube}</svg>;
}
function ToolButton({ title, children, onClick, active, disabled }: { title: string; children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return <button type="button" className={`w-icon-button${active ? " active" : ""}`} aria-label={title} title={title} aria-pressed={active} disabled={disabled} onClick={onClick}>{children}</button>;
}
function fitCamera(entities: Entity[]): Camera {
  const visible = entities.filter(e => e.pos && !["camera", "light"].includes(e.kind) && e.shape?.type !== "plane" && !/floor|ground|perimeter/.test(e.id));
  if (!visible.length) return INITIAL;
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  visible.forEach(e => {
    const p = e.pos!, s = e.shape?.size;
    const extent = e.pack ? [.35, .35, .65] : s?.length === 3 ? s : [s?.[0] || .08, s?.[0] || .08, s?.[1] || s?.[0] || .08];
    for (let i = 0; i < 3; i++) { low[i] = Math.min(low[i], p[i] - (e.pack && i === 2 ? 0 : extent[i])); high[i] = Math.max(high[i], p[i] + extent[i] * (e.pack && i === 2 ? 2 : 1)); }
  });
  return { ...INITIAL, lx: (low[0] + high[0]) / 2, ly: (low[1] + high[1]) / 2, lz: (low[2] + high[2]) / 2,
    distance: Math.min(20, Math.max(2.5, Math.max(...high.map((v, i) => v - low[i])) * 1.65)) };
}

function Viewport({ stage, version, entities, focus, revision, onReady }: { stage: string; version: number; entities: Entity[]; focus: { id: string; n: number } | null; revision: number; onReady: () => void }) {
  const [cam, setCam] = useState<Camera>(() => fitCamera(entities));
  const [preset, setPreset] = useState("Perspective");
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState({ width: 1280, height: 800 });
  const area = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const source = useRef("");
  const ready = useRef(onReady); ready.current = onReady;
  const fitted = useRef(entities.length > 0);
  useEffect(() => { if (!fitted.current && entities.length) { setCam(fitCamera(entities)); fitted.current = true; } }, [entities]);
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) {
        const ratio = Math.min(2, 1280 / width, 960 / height);
        setSize({ width: Math.max(64, Math.round(width * ratio)), height: Math.max(64, Math.round(height * ratio)) });
      }
    });
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams(Object.entries({ ...cam, ...size }).map(([k, v]) => [k, String(v)]));
      try {
        const response = await fetch(auth(`/api/world/${encodeURIComponent(stage)}/view?${params}&v=${version}`), { signal: controller.signal });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || response.statusText);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const next = URL.createObjectURL(blob), old = source.current;
        source.current = next; setSrc(next); setError("");
        if (old) URL.revokeObjectURL(old);
        ready.current();
      } catch (e) { if (!controller.signal.aborted) setError(errorText(e)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 140);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [stage, cam, size, version]);
  useEffect(() => () => { if (source.current) URL.revokeObjectURL(source.current); }, []);
  useEffect(() => {
    const entity = focus && entities.find(e => e.id === focus.id);
    if (entity?.pos) setCam(c => ({ ...c, lx: entity.pos![0], ly: entity.pos![1], lz: entity.pos![2] + (entity.pack ? .45 : 0), distance: entity.pack ? 2.8 : 1.7 }));
    // Focusing is an explicit action, not a response to later entity updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  const zoom = (factor: number) => setCam(c => ({ ...c, distance: Math.min(20, Math.max(.5, c.distance * factor)) }));
  const reset = () => { setCam(fitCamera(entities)); setPreset("Perspective"); };
  const choose = (p: string) => { setPreset(p); setCam(c => ({ ...c, azimuth: p === "Front" ? 90 : p === "Top" ? 90 : INITIAL.azimuth, elevation: p === "Top" ? -89 : p === "Front" ? -5 : INITIAL.elevation })); };
  const snapshot = () => { if (!src) return; const a = document.createElement("a"); a.href = src; a.download = `${stage}-view.png`; a.click(); };
  const fullscreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await frame.current?.requestFullscreen(); } catch (e) { setError(errorText(e)); } };
  return <section className="w-canvas" ref={frame} aria-label="World viewport">
    <div className="w-canvas-bar"><span className="w-view-label"><Glyph name="cube" /> Scene view</span>
      <div className="w-view-presets" aria-label="Camera views">{["Perspective", "Top", "Front"].map(p => <button type="button" key={p} className={preset === p ? "on" : ""} aria-pressed={preset === p} onClick={() => choose(p)}>{p}</button>)}</div>
      <div className="w-canvas-actions"><ToolButton title="Save snapshot" disabled={!src} onClick={snapshot}><Glyph name="camera" /></ToolButton><ToolButton title="Toggle fullscreen" onClick={fullscreen}><Glyph name="expand" /></ToolButton></div>
    </div>
    <div className="w-view-area" ref={area} tabIndex={0} role="region" aria-label="Interactive 3D view. Drag or use arrow keys to orbit; plus and minus to zoom."
      onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus(); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onPointerMove={e => { if (!drag.current) return; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; setPreset("Perspective"); setCam(c => ({ ...c, azimuth: c.azimuth - dx * .35, elevation: Math.max(-89, Math.min(-2, c.elevation - dy * .3)) })); }}
      onWheel={e => zoom(e.deltaY > 0 ? 1.1 : .9)}
      onKeyDown={e => { if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(.85); } else if (e.key === "-") { e.preventDefault(); zoom(1.15); } else if (e.key.startsWith("Arrow")) { e.preventDefault(); setCam(c => ({ ...c, azimuth: c.azimuth + (e.key === "ArrowLeft" ? 10 : e.key === "ArrowRight" ? -10 : 0), elevation: Math.max(-89, Math.min(-2, c.elevation + (e.key === "ArrowUp" ? -5 : e.key === "ArrowDown" ? 5 : 0))) })); } }}>
      {src ? <img src={src} alt="world view" draggable={false} /> : <div className="w-view-loading"><span className="w-orbit-symbol"><Glyph name="cube" size={38} /></span><strong>{error ? "The view could not load" : "Preparing your world"}</strong><span>{error || "Setting up the scene and camera…"}</span></div>}
      <div className="w-canvas-hud"><span className="w-hud-chip"><i className={loading ? "working" : ""} />{loading ? "Updating view" : entities.length ? "Scene ready" : "Empty scene"}</span><span className="w-hud-chip w-revision">REV {String(revision).padStart(2, "0")}</span></div>
      {!entities.length && src && <div className="w-empty-canvas"><div><Glyph name="spark" size={28} /></div><h2>A world of possibilities.</h2><p>Describe a scene in chat.<br />Your ideas take shape here.</p></div>}
      <svg className="w-axis" viewBox="0 0 64 64" aria-hidden="true">{[["X", "#c7695d", 1, 0, 0], ["Y", "#648868", 0, 1, 0], ["Z", "#6690b0", 0, 0, 1]].map(([label, color, x, y, z]) => {
        const az = cam.azimuth * Math.PI / 180, el = cam.elevation * Math.PI / 180;
        const dx = (-Math.sin(az) * Number(x) + Math.cos(az) * Number(y)) * 20;
        const dy = (Math.sin(el) * Math.cos(az) * Number(x) + Math.sin(el) * Math.sin(az) * Number(y) - Math.cos(el) * Number(z)) * 20;
        return <g key={String(label)}><line x1="32" y1="37" x2={32 + dx} y2={37 + dy} stroke={String(color)} strokeWidth="1.5" /><circle cx={32 + dx} cy={37 + dy} r="6" fill="#fffffff0" /><text x={32 + dx} y={40 + dy} fontSize="8" textAnchor="middle" fill={String(color)}>{label}</text></g>;
      })}<circle cx="32" cy="37" r="2" fill="#8c9b90" /></svg>
    </div>
    <div className="w-canvas-bottom"><span><span className="w-key">↔</span> Drag to orbit <b>·</b> Scroll to zoom</span><div className="w-camera-dock"><ToolButton title="Zoom out" onClick={() => zoom(1.15)}><Glyph name="minus" /></ToolButton><span>{cam.distance.toFixed(1)}<small> m</small></span><ToolButton title="Zoom in" onClick={() => zoom(.85)}><Glyph name="plus" /></ToolButton><i /><ToolButton title="Fit scene" onClick={reset}><Glyph name="focus" /></ToolButton></div></div>
    {error && src && <div className="w-view-error" role="alert">{error}</div>}
  </section>;
}

function useTranscript(stage: string, onChange: () => void) {
  const [rows, setRows] = useState<Event[]>([]), [running, setRunning] = useState(false), [error, setError] = useState("");
  const changed = useRef(onChange); changed.current = onChange;
  useEffect(() => {
    let after = 0, alive = true, first = true, wasRunning = false, timer: ReturnType<typeof setTimeout>;
    setRows([]); setRunning(false); setError("");
    const pull = async () => {
      try {
        const d = await get(`/api/world/${encodeURIComponent(stage)}/transcript?after=${after}`);
        if (!alive) return;
        if (d.events.length) setRows(r => [...r, ...d.events].slice(-400));
        if ((!first && d.events.some((e: Event) => e.kind === "act" && e.ok)) || wasRunning !== d.running) changed.current();
        first = false; after = d.lines; wasRunning = d.running;
        setRunning(d.running); setError("");
      } catch (e) { if (alive) setError(errorText(e)); }
      finally { if (alive) timer = setTimeout(pull, 2000); }
    };
    pull(); return () => { alive = false; clearTimeout(timer); };
  }, [stage]);
  return { rows, running, error };
}
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((s, i) => s.startsWith("**") ? <strong key={i}>{s.slice(2, -2)}</strong> : s.startsWith("`") ? <code key={i}>{s.slice(1, -1)}</code> : <Fragment key={i}>{s}</Fragment>)}</>;
}
function Markdown({ text }: { text: string }) {
  return <div className="w-prose">{text.split(/\n\s*\n/).map((block, i) => {
    const lines = block.trim().split("\n");
    if (lines.length > 1 && lines.every(s => s.trim().startsWith("|"))) {
      const cells = lines.map(s => s.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim())).filter(row => !row.every(c => /^[:\- ]+$/.test(c)));
      return <div key={i} className="w-table-scroll"><table><thead><tr>{cells[0]?.map((c, j) => <th key={j}><Inline text={c} /></th>)}</tr></thead><tbody>{cells.slice(1).map((row, j) => <tr key={j}>{row.map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>)}</tbody></table></div>;
    }
    if (lines.every(s => /^[-*] /.test(s))) return <ul key={i}>{lines.map((s, j) => <li key={j}><Inline text={s.slice(2)} /></li>)}</ul>;
    return <p key={i}><Inline text={block.replace(/^#{1,4} /, "")} /></p>;
  })}</div>;
}
const names: Record<string, string> = { stage_show: "Read scene", stage_edit: "Updated scene", world_build: "Built world", world_state: "Read world state", view: "Inspected scene", check: "Checked goal", act: "Ran action", packs: "Read robot library" };
function parseResult(e: Event) { try { return JSON.parse(e.result || "{}"); } catch { return {}; } }
function resultLabel(e: Event) {
  const b = parseResult(e);
  if (!e.ok) return b.error?.message || "The tool reported an error";
  if (e.name === "stage_edit") return `Revision ${b.revision} · ${b.entities} entities`;
  if (e.name === "world_build") return `Revision ${b.revision} · ${Object.keys(b.robots || {}).length} robots`;
  if (e.name === "check") return b.satisfied ? "Goal satisfied" : `Not satisfied: ${(b.reasons || []).join(", ")}`;
  return e.name === "view" ? "Scene image captured" : "Completed";
}
function Conversation({ rows, running, pending, onPrompt }: { rows: Event[]; running: boolean; pending: string; onPrompt: (s: string) => void }) {
  const scroll = useRef<HTMLDivElement>(null), follow = useRef(true);
  const items = useMemo(() => {
    const out: { type: string; events: Event[] }[] = [];
    for (const e of rows) {
      if (e.type === "result") { if (out[out.length - 1]?.type === "tools") out[out.length - 1]!.events.push(e); else out.push({ type: "tools", events: [e] }); }
      else if (e.type === "operator" || (e.type === "turn" && e.text) || e.type === "summary") out.push({ type: e.type, events: [e] });
    }
    return out;
  }, [rows]);
  useEffect(() => { if (follow.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [rows, pending, running]);
  return <div ref={scroll} className="w-conversation" aria-label="Conversation" onScroll={e => { const b = e.currentTarget; follow.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80; }}>
    {!items.length && !pending && <div className="w-chat-welcome"><span className="w-ai-emblem"><Glyph name="spark" size={27} /></span><span className="w-eyebrow">YOUR WORLD, YOUR WORDS</span><h2>What will you<br />build today?</h2><p>Start with an idea. Add robots, shape a scene, and refine it together.</p><div className="w-starters">
      {[['robot', 'A robot workspace', 'Build a workbench with a Panda arm, a blue work mat and a few colored blocks.'], ['layers', 'A sorting station', 'Create a sorting station with three trays and colored objects on a table.'], ['cube', 'Start with a simple scene', 'Create a table with a red cube, a blue sphere and a yellow cylinder.']].map(([icon, title, prompt]) => <button type="button" key={title} onClick={() => onPrompt(prompt)}><Glyph name={icon} /><span>{title}</span><Glyph name="chevron" size={14} /></button>)}
    </div></div>}
    {items.map(item => {
      const e = item.events[0];
      if (item.type === "tools") {
        const errors = item.events.filter(e => !e.ok).length;
        const built = item.events.some(e => e.name === "world_build" && e.ok);
        return <details className={`w-tool-group${errors ? " has-errors" : ""}`} key={e.n}><summary><span className="w-tool-state"><Glyph name={errors ? "alert" : "check"} size={14} /></span><span>{built ? "World built" : "Scene activity"}<small>{item.events.length} {item.events.length === 1 ? "step" : "steps"}{errors ? ` · ${errors} ${errors === 1 ? "error" : "errors"}` : " completed"}</small></span><Glyph name="chevron" size={14} /></summary><div className="w-tool-details">{item.events.map(t => <div className={t.ok ? "" : "failed"} key={t.n}><strong>{names[t.name || ""] || t.name || "Tool call"}</strong><span>{resultLabel(t)}</span><code>{t.name || "parse_error"}</code></div>)}</div></details>;
      }
      if (item.type === "summary") return <div className="w-session-end" key={e.n}><span />Session ended<span /></div>;
      const user = item.type === "operator", text = user ? e.message || "" : e.text || "";
      return <article className={`w-message ${user ? "from-user" : "from-ai"}`} key={e.n}><div className="w-message-by">{user ? <span className="w-user-avatar">Y</span> : <Glyph name="spark" size={16} />}{user ? "You" : "World agent"}</div>{text.length > (user ? 400 : 1100) ? <details className="w-long-message"><summary><Markdown text={text.slice(0, user ? 240 : 420) + "…"} /><span>Read full message <Glyph name="chevron" size={12} /></span></summary><Markdown text={text} /></details> : <Markdown text={text} />}</article>;
    })}
    {pending && !rows.some(e => e.type === "operator" && e.message === pending) && <article className="w-message from-user pending"><div className="w-message-by"><span className="w-user-avatar">Y</span>You</div><Markdown text={pending} /><small>Sending to the world agent…</small></article>}
    {running && <div className="w-thinking" role="status"><Glyph name="spark" size={15} /><span>The agent is working<span className="w-thinking-dots">…</span></span></div>}
  </div>;
}

function SceneInspector({ entities, onFocus }: { entities: Entity[]; onFocus: (id: string) => void }) {
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(""), [robotsOnly, setRobotsOnly] = useState(false);
  const filtered = entities.filter(e => (!robotsOnly || e.pack) && `${e.id} ${e.pack || e.kind}`.toLowerCase().includes(query.toLowerCase()));
  const entity = entities.find(e => e.id === selected);
  return <div className="w-inspector"><div className="w-inspector-heading"><h3>Scene collection</h3><span>{entities.length} objects</span></div><label className="w-search"><Glyph name="search" size={16} /><input aria-label="Search objects" placeholder="Search objects…" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="w-filter-chips"><button type="button" className={!robotsOnly ? "on" : ""} onClick={() => setRobotsOnly(false)}>All objects</button><button type="button" className={robotsOnly ? "on" : ""} onClick={() => setRobotsOnly(true)}>Robots · {entities.filter(e => e.pack).length}</button></div><div className="w-entity-list">{filtered.map(e => <button type="button" key={e.id} className={`w-entity${selected === e.id ? " selected" : ""}`} onClick={() => setSelected(e.id)} aria-pressed={selected === e.id}><span className={`w-entity-icon${e.pack ? " robot" : ""}`}><Glyph name={e.pack ? "robot" : "cube"} size={18} /></span><span><strong>{pretty(e.id)}</strong><small>{e.pack || e.shape?.type || e.kind}</small></span><Glyph name="chevron" size={13} /></button>)}{!filtered.length && <p className="w-muted">{entities.length ? "No objects match this search." : "Your scene is empty. Add something in chat."}</p>}</div>{entity && <div className="w-entity-detail"><div><strong>{pretty(entity.id)}</strong><code>{entity.id}</code></div><span className="w-eyebrow">POSITION · METERS</span><div className="w-coordinates">{["X", "Y", "Z"].map((label, i) => <span key={label}><small>{label}</small>{entity.pos?.[i]?.toFixed(3) ?? "—"}</span>)}</div><button type="button" className="w-button secondary" onClick={() => onFocus(entity.id)}><Glyph name="focus" size={16} />Focus in view</button></div>}</div>;
}

export function WorldStage() {
  const { stage = "" } = useParams();
  return <WorldWorkspace key={stage} stage={stage} />;
}
function WorldWorkspace({ stage }: { stage: string }) {
  const [overview, error, reload] = useApi<any>(`/api/world/${encodeURIComponent(stage)}`);
  const [version, setVersion] = useState(0), [tab, setTab] = useState("Chat"), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(""), [sending, setSending] = useState(false), [actionError, setActionError] = useState(""), [pending, setPending] = useState("");
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [action, setAction] = useState('{"robot":"","kind":"hold","duration_s":1}');
  const [goal, setGoal] = useState('{"op":"lifted","entity":"cube","min_z":0.5}');
  const [output, setOutput] = useState<any>(null);
  const reloadRef = useRef(reload); reloadRef.current = reload;
  const bump = useCallback(() => { setVersion(v => v + 1); reloadRef.current(); }, []);
  const viewReady = useCallback(() => reloadRef.current(), []);
  const { rows, running, error: transcriptError } = useTranscript(stage, bump);
  const composer = useRef<HTMLTextAreaElement>(null);
  const entities: Entity[] = overview?.stage?.entities || [];
  const robots = entities.filter(e => e.pack);
  useEffect(() => { if (robots.length) setAction(a => a === '{"robot":"","kind":"hold","duration_s":1}' ? JSON.stringify({ robot: robots[0].id, kind: "hold", duration_s: 1 }, null, 2) : a); }, [robots[0]?.id]);
  useEffect(() => { if (pending && rows.some(e => e.type === "operator" && e.message === pending)) setPending(""); }, [rows, pending]);
  if (error) return <Err e={error} />;
  if (!overview) return <Loading what="world" />;
  const call = async (tool: string, args: any) => {
    setBusy(tool); setActionError("");
    try { const result = await post(`/api/world/${encodeURIComponent(stage)}/call`, { tool, arguments: args }); setOutput(result); if (!result.ok) setActionError(result.error?.message || "The operation did not complete."); bump(); }
    catch (e) { setActionError(errorText(e)); } finally { setBusy(""); }
  };
  const send = async () => {
    const text = message.trim(); if (!text || sending) return;
    setSending(true); setActionError(""); setPending(text);
    try { await post(`/api/world/${encodeURIComponent(stage)}/chat`, { message: text }); setMessage(""); }
    catch (e) { setActionError(errorText(e)); setPending(""); }
    finally { setSending(false); }
  };
  const stop = async () => { try { await post(`/api/world/${encodeURIComponent(stage)}/stop`); bump(); } catch (e) { setActionError(errorText(e)); } };
  const draft = (text: string) => { setMessage(text); composer.current?.focus(); };
  const runJson = (which: "action" | "goal") => {
    try { const value = JSON.parse(which === "action" ? action : goal); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter a JSON object.");
      if (which === "action") call("act", { actions: [{ ...value, expected_generation: overview.world?.generation }] }); else call("check", { goal: value });
    } catch (e) { setActionError(`Invalid JSON: ${errorText(e)}`); }
  };
  const current = overview.world && overview.world.revision === overview.stage.revision;
  return <div className="world-studio">
    <header className="w-topbar"><div className="w-breadcrumb"><Link to="/world"><Glyph name="back" size={16} />All worlds</Link><span>/</span><strong>{pretty(stage)}</strong></div><div className="w-top-actions"><span className={`w-status${running || sending ? " active" : ""}`}><i />{running || sending ? "Agent working" : current ? "Scene up to date" : entities.length ? "Changes to build" : "Ready to create"}</span><Link className="w-history-link" to="/runs">Runs & replays <Glyph name="chevron" size={13} /></Link></div></header>
    <div className="w-workspace-heading"><div><div className="w-eyebrow">HYLO WORLD STUDIO</div><h1>{pretty(stage)}<span className="w-title-dot" /></h1><p>{entities.length ? "A space to build, explore, and refine together." : "Every world begins with an idea."}</p></div><button type="button" className="w-button primary" onClick={() => call("world_build", {})} disabled={!!busy || running}><Glyph name={busy === "world_build" ? "reset" : "play"} size={17} />{busy === "world_build" ? "Building…" : "Build world"}</button></div>
    <div className="w-workspace-grid"><div className="w-scene-column"><Viewport stage={stage} version={version} entities={entities} focus={focus} revision={overview.stage.revision} onReady={viewReady} /><footer className="w-scene-strip"><span className="w-scene-strip-icon"><Glyph name="layers" size={19} /></span><div><strong>{entities.length ? "Your scene, assembled." : "A fresh canvas."}</strong><span>{entities.length ? `${entities.length} objects · ${robots.length} ${robots.length === 1 ? "robot" : "robots"}` : "Add your first object through chat"}</span></div><button type="button" onClick={() => setTab("Scene")}>Explore objects <Glyph name="chevron" size={14} /></button></footer></div>
      <aside className="w-sidebar"><div className="w-sidebar-title"><span className="w-sidebar-emblem"><Glyph name="spark" size={18} /></span><div><strong>World builder</strong><span>Turn ideas into environments</span></div><span className="w-ai-badge">AI</span></div><div className="w-tabs" role="tablist" aria-label="Workspace panels">{["Chat", "Scene", "Controls"].map(t => <button type="button" key={t} role="tab" id={`tab-${t}`} aria-controls={`panel-${t}`} aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}><Glyph name={t === "Chat" ? "spark" : t === "Scene" ? "layers" : "sliders"} size={15} />{t}{t === "Scene" && <small>{entities.length}</small>}</button>)}</div>
      <div className="w-sidebar-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "Chat" && <><Conversation rows={rows} running={running || sending} pending={pending} onPrompt={draft} />{transcriptError && <div className="w-inline-error" role="alert">Connection interrupted. Retrying… <span>{transcriptError}</span></div>}<form className="w-compose" onSubmit={e => { e.preventDefault(); send(); }}><div className="w-compose-box"><textarea ref={composer} aria-label="Message to world builder" placeholder={running ? "Guide the agent while it works…" : "Describe what you want to build…"} value={message} onChange={e => setMessage(e.target.value)} rows={3} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /><div className="w-compose-toolbar"><span><Glyph name="spark" size={13} />World agent</span><div>{running && <button type="button" className="w-stop-button" onClick={stop} aria-label="Stop agent" title="Stop agent"><Glyph name="stop" size={15} /></button>}<button type="submit" className="w-send-button" disabled={!message.trim() || sending} aria-label={running ? "Send update" : "Send message"}><Glyph name="arrow" size={17} /></button></div></div></div><div className="w-compose-hint"><span>Enter to send <b>·</b> Shift + Enter for a new line</span><span>↵</span></div></form></>}
        {tab === "Scene" && <SceneInspector entities={entities} onFocus={id => setFocus({ id, n: Date.now() })} />}
        {tab === "Controls" && <div className="w-controls"><div className="w-controls-intro"><Glyph name="sliders" size={21} /><h3>Fine-tune the world</h3><p>Run an action or check a goal against the current scene.</p></div><label htmlFor="world-action">Robot action <span>JSON</span></label><textarea id="world-action" value={action} onChange={e => setAction(e.target.value)} rows={7} spellCheck={false} /><button type="button" className="w-button secondary" disabled={!!busy || !overview.world} onClick={() => runJson("action")}><Glyph name="robot" size={16} />{busy === "act" ? "Running…" : "Run action"}</button><label htmlFor="world-goal">Goal check <span>JSON</span></label><textarea id="world-goal" value={goal} onChange={e => setGoal(e.target.value)} rows={5} spellCheck={false} /><button type="button" className="w-button secondary" disabled={!!busy || !overview.world} onClick={() => runJson("goal")}><Glyph name="check" size={16} />Check goal</button>{output && <details className="w-result" open><summary>Last result <span>{output.ok ? "Completed" : "Error"}</span></summary><pre>{JSON.stringify(output.ok ? output.result : output.error, null, 2)}</pre></details>}</div>}
      </div>{actionError && <div className="w-inline-error" role="alert"><Glyph name="alert" size={16} />{actionError}<button type="button" onClick={() => setActionError("")} aria-label="Dismiss error"><Glyph name="close" size={14} /></button></div>}</aside>
    </div>
  </div>;
}
