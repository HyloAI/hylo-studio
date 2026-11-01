import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { pct } from "../api";

export function PageHead({ crumbs, title, children, aside }: { crumbs?: [string, string?][]; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="head">
      <div className="grow">
        {crumbs && <div className="crumbs label">{crumbs.map(([t, to], i) => <span key={i}>{to ? <Link to={to}>{t}</Link> : t}{i < crumbs.length - 1 && " /"}</span>)}</div>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {aside && <div className="aside">{aside}</div>}
    </header>
  );
}

export function Panel({ title, right, children, flush, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && <div className="ph"><span className="label">{title}</span><span className="grow" />{right}</div>}
      <div className={`pb ${flush ? "flush" : ""}`}>{children}</div>
    </section>
  );
}

const OUT: Record<string, string> = {
  success: "ok", failure: "bad", error: "haz", safety_abort: "haz", infra_invalid: "haz",
  promoted: "ok", verified: "ok", gate_passed: "ok", done: "ok",
  refuted: "bad", rejected: "bad", gated_fail: "bad", failed: "bad",
  running: "sig", pending: "sig", archived: "", proposed: "",
};

export function Pill({ v, label }: { v?: string | null; label?: string }) {
  return <span className={`pill ${OUT[v || ""] ?? ""}`}>{(label ?? v ?? "–").replace(/_/g, " ")}</span>;
}

export function Meter({ value, good }: { value: number | null | undefined; good?: boolean }) {
  return (
    <span className={`meter ${good ? "ok" : ""}`}>
      <span className="t"><i style={{ width: `${(value ?? 0) * 100}%` }} /></span>
      <span className="n">{pct(value)}</span>
    </span>
  );
}

export function Figs({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className="figs">
      {items.map((f) => <div className="fig" key={f.label}><div className="label">{f.label}</div><div className="v">{f.value}</div>{f.sub && <div className="s">{f.sub}</div>}</div>)}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: T[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="seg">
      {options.map((o) => <button key={String(o)} className={o === value ? "on" : ""} disabled={disabled} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  );
}

export function Reveal({ label, children }: { label: string; children: ReactNode }) {
  const [o, setO] = useState(false);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button className="toggle" onClick={() => setO(!o)}>{o ? "▾" : "▸"} {label}</button>
      {o && children}
    </div>
  );
}

export function Err({ e }: { e: string | null }) {
  return e ? <div className="panel"><div className="pb err">{e}</div></div> : null;
}

export function Loading({ what = "" }: { what?: string }) {
  return <div className="empty-state">Loading {what}…</div>;
}

export function SplitChip({ split }: { split?: string | null }) {
  return <span className={`chip ${split?.startsWith("gate") ? "gate" : ""}`}>{split || "–"}</span>;
}
