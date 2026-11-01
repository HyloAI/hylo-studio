// Recursive self-improvement: every candidate drawn as its path through the cascade.
import { ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { pct, post, useApi } from "../api";
import { Err, Figs, Loading, PageHead, Panel, Pill } from "../components/parts";

export function Campaigns() {
  const [cs, err] = useApi<any[]>("/api/campaigns");
  const nav = useNavigate();
  if (err) return <Err e={err} />;
  if (!cs) return <Loading />;
  return (
    <>
      <PageHead title="Self-improvement" />
      <Panel flush>
        <table className="tbl">
          <thead><tr><th>campaign</th><th>proposer</th><th className="r">cycles</th><th className="r">candidates</th><th>state</th></tr></thead>
          <tbody>{cs.map((c) => (
            <tr key={c.id} className="click" onClick={() => nav(`/campaigns/${encodeURIComponent(c.id)}`)}>
              <td><div>{c.name}</div><div className="mono faint" style={{ fontSize: 11.5 }}>{c.id}</div></td>
              <td className="mono dim" style={{ fontSize: 12 }}>{c.proposer}</td>
              <td className="r num">{c.cycles_done}</td><td className="r num">{c.candidates}</td>
              <td>{c.pending ? <Pill v="pending" label="awaiting approval" /> : <span className="dim" style={{ fontSize: 12.5 }}>{c.stopped}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </>
  );
}

const fmtP = (p?: number | null) => (p === null || p === undefined ? "" : p < 0.001 ? p.toExponential(1) : p.toFixed(3));

function Step({ title, state, children }: { title: string; state: "pass" | "fail" | "idle" | "veto"; children?: ReactNode }) {
  const color = { pass: "var(--ok)", fail: "var(--bad)", idle: "var(--line-2)", veto: "var(--hazard)" }[state];
  return (
    <div style={{ minWidth: 0, borderTop: `3px solid ${color}`, paddingTop: 8 }} className={state === "veto" ? "" : ""}>
      <div className="label" style={{ color: state === "idle" ? "var(--ink-3)" : "var(--ink-2)" }}>{title}</div>
      <div style={{ fontSize: 12.5, marginTop: 4 }} className={state === "idle" ? "faint" : ""}>{children}</div>
    </div>
  );
}

function Cascade({ e }: { e: any }) {
  const st = e.stages || [];
  const s1 = st.find((s: any) => s.stage === 1);
  const s2 = st.find((s: any) => s.stage === 2);
  const looks = st.filter((s: any) => s.stage === 3);
  const veto = looks.some((l: any) => (l.notes || "").includes("more safety"));
  const reached = e.stage_reached ?? 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${2 + Math.max(1, looks.length) + 1}, minmax(0, 1fr))`, gap: 10 }}>
      <Step title="1 · early check" state={reached >= 1 ? (e.verdict === "rejected" && reached === 1 ? "fail" : "pass") : e.verdict === "rejected" ? "fail" : "idle"}>
        {s1 ? <span className="num">{s1.wins} won · {s1.losses} lost</span> : e.evidence?.stage0 ? <span className="bad">{e.evidence.stage0}</span> : "–"}
      </Step>
      <Step title="2 · search_val" state={!s2 ? "idle" : reached >= 3 ? "pass" : "fail"}>
        {s2 ? <span className="num">{pct(s2.parent_success)} → {pct(s2.success)}<br /><span className="faint">{s2.wins}/{s2.losses} · p {fmtP(s2.p_value)}</span></span> : "not reached"}
      </Step>
      {(looks.length ? looks : [null]).map((l: any, i: number) => {
        const m = /look (\d+)\/(\d+) at level ([\d.e-]+)/.exec(l?.notes || "");
        const level = m ? parseFloat(m[3]) : null;
        const sig = l && level !== null && l.p_value !== null && l.p_value <= level;
        return (
          <Step key={i} title={m ? `3 · gate look ${m[1]}/${m[2]}` : "3 · gate"} state={!l ? "idle" : sig && (l.notes || "").includes("more safety") ? "veto" : sig ? "pass" : "fail"}>
            {l ? <span className="num">{pct(l.parent_success)} → {pct(l.success)}<br /><span className="faint">{l.wins}/{l.losses} · p {fmtP(l.p_value)}{level !== null && <> vs α {level}</>}</span></span> : "not reached"}
          </Step>
        );
      })}
      <Step title="verdict" state={e.verdict === "promoted" || e.verdict === "gate_passed" ? "pass" : veto ? "veto" : e.verdict === "archived" ? "idle" : "fail"}>
        <Pill v={e.verdict} />
        {veto && <div className="row tight" style={{ marginTop: 6 }}><span className="hazard" style={{ width: 16, height: 9 }} /><span className="haz">safety veto</span></div>}
      </Step>
    </div>
  );
}

export function CampaignDetail() {
  const { id = "" } = useParams();
  const [c, err, reload] = useApi<any>(`/api/campaign?id=${encodeURIComponent(id)}`);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"approve" | "rollback" | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (err) return <Err e={err} />;
  if (!c) return <Loading what="campaign" />;
  const st = c.state || {};
  const act = async () => {
    try {
      if (confirm === "approve") { const r = await post(`/api/campaign/approve?id=${encodeURIComponent(id)}`, {}); setMsg(`Promoted ${r.promoted}.`); }
      else { const r = await post(`/api/campaign/rollback?id=${encodeURIComponent(id)}`, { reason }); setMsg(`Rolled back. Active version: ${r.active ?? "base config"}.`); }
      setConfirm(null); setReason(""); reload();
    } catch (e: any) { setMsg(String(e.message || e)); }
  };
  return (
    <>
      <PageHead crumbs={[["Self-improvement", "/campaigns"], [id]]} title={st.name}
        aside={c.active && <button className="btn" onClick={() => setConfirm("rollback")}>Roll back…</button>}>
        Proposer <code>{c.config?.proposer?.type}</code> · {st.stopped}
      </PageHead>
      <Figs items={[
        { label: "cycles", value: st.cycles_done },
        { label: "candidates", value: c.archive.length },
        { label: "reached the gate", value: c.archive.filter((e: any) => e.stage_reached >= 3).length },
        { label: "active version", value: <span style={{ fontSize: 17 }}>{c.active || "base config"}</span> },
        { label: "wall clock", value: <>{Math.round((st.elapsed_s || 0) / 60)}<small>min</small></> },
      ]} />

      {(c.pending || confirm || msg) && (
        <div className="panel" style={{ marginTop: 16, borderColor: confirm === "rollback" ? "var(--bad)" : "var(--signal)" }}>
          <div className="pb stack" style={{ gap: 10 }}>
            {c.pending && !confirm && <div className="row"><Pill v="pending" label="awaiting approval" /><span><b className="mono">{c.pending.candidate_id}</b> passed the gate in cycle {c.pending.cycle}.</span>
              <span className="grow" /><button className="btn go" onClick={() => setConfirm("approve")}>Review and approve</button></div>}
            {confirm === "approve" && <div className="row"><span>Promote <b className="mono">{c.pending?.candidate_id}</b>? It becomes the active configuration of this campaign.</span><span className="grow" />
              <button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn go" onClick={act}>Promote</button></div>}
            {confirm === "rollback" && <div className="row"><input id="reason" placeholder="Reason, recorded in the ledger" value={reason} onChange={(e) => setReason(e.target.value)} style={{ maxWidth: 420 }} />
              <span className="grow" /><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn stop" disabled={!reason} onClick={act}>Roll back</button></div>}
            {msg && <div className="dim">{msg}</div>}
          </div>
        </div>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        {c.cycles.map((cy: any) => {
          const entries = c.archive.filter((e: any) => cy.candidates.includes(e.candidate.id));
          return (
            <Panel key={cy.cycle} title={`${cy.cycle} · parent ${cy.parent_id || "base config"} · ${Math.round(cy.elapsed_s / 60)} min`}
              right={cy.promoted ? <Pill v="promoted" label={`promoted ${cy.promoted}`} /> : <Pill v="rejected" label="no promotion" />} flush>
              {entries.map((e: any) => (
                <div key={e.candidate.id} style={{ padding: 14, borderBottom: "1px solid var(--line)" }} className="stack">
                  <div className="row" style={{ alignItems: "baseline" }}>
                    <span className="mono" style={{ fontSize: 12.5 }}>{e.candidate.id}</span>
                    <span className="faint mono" style={{ fontSize: 11.5 }}>{e.candidate.generator}</span>
                    <span className="grow" />
                    <button className="toggle" onClick={() => setOpen(open === e.candidate.id ? null : e.candidate.id)}>{open === e.candidate.id ? "▾ hide patch and evidence" : "▸ patch and evidence"}</button>
                  </div>
                  <div className="clamp2 dim" style={{ maxWidth: "100ch" }} title={e.hypothesis}>{e.hypothesis}</div>
                  <Cascade e={e} />
                  {open === e.candidate.id && (
                    <div className="cols c2">
                      <div className="stack" style={{ gap: 6 }}><span className="label">config patch</span><pre className="json">{JSON.stringify(e.candidate.patch, null, 2)}</pre></div>
                      <div className="stack" style={{ gap: 6 }}><span className="label">evidence</span><pre className="json">{JSON.stringify({ rationale: e.candidate.rationale, ...e.evidence, ...e.candidate.evidence }, null, 2)}</pre></div>
                    </div>
                  )}
                </div>
              ))}
              {cy.heldout && <div style={{ padding: "10px 14px" }} className="dim">Held-out, reported only: {pct(cy.heldout.parent_success)} → {pct(cy.heldout.candidate_success)}</div>}
            </Panel>
          );
        })}
        <Panel title="Ledger">
          <div className="console">
            {c.ledger.length ? c.ledger.map((l: any, i: number) => (
              <div key={i}><span className="t">{new Date(l.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span className={l.op === "reject" ? "faint" : l.op === "promote" ? "" : ""}>{l.op} · {l.id}{l.gate?.verdict ? ` · ${l.gate.verdict}` : ""}{l.reason ? ` · ${l.reason}` : ""}</span></div>
            )) : <span className="faint">empty</span>}
          </div>
        </Panel>
      </div>
    </>
  );
}
