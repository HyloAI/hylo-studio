import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { get } from "./api";
import { Icon } from "./components/icons";
import { CampaignDetail, Campaigns } from "./pages/Campaigns";
import { Compare } from "./pages/Compare";
import { Experience } from "./pages/Experience";
import { Jobs } from "./pages/Jobs";
import { Live } from "./pages/Live";
import { Operator } from "./pages/Operator";
import { Overview } from "./pages/Overview";
import { Research, ResearchSession } from "./pages/Research";
import { Episode, RunDetail, Runs } from "./pages/Runs";
import { WorldStage, Worlds } from "./pages/World";
import "./styles.css";

const NAV: [string, string, () => JSX.Element][] = [
  ["/", "Console", Icon.console], ["/live", "Live sandbox", Icon.live], ["/operator", "Operator station", Icon.station], ["/runs", "Runs & replays", Icon.runs],
  ["/compare", "A/B arena", Icon.compare], ["/campaigns", "Self-improvement", Icon.loop], ["/research", "Research", Icon.research], ["/experience", "Experience", Icon.learn],
  ["/jobs", "Jobs", Icon.jobs], ["/world", "World", Icon.world],
];

function Rail() {
  const [o, setO] = useState<any>(null);
  useEffect(() => {
    const pull = () => get("/api/overview").then(setO).catch(() => {});
    pull();
    const id = setInterval(pull, 5000);
    return () => clearInterval(id);
  }, []);
  const cal = o?.judge?.calibration;
  return (
    <nav className="rail">
      <div className="brand"><Icon.mark /><div><b>Hylo</b><small>workcell console</small></div></div>
      <div className="nav">
        {NAV.map(([to, label, I]) => <NavLink key={to} to={to} end={to === "/"} title={label} aria-label={label}><I /><span className="nav-label">{label}</span></NavLink>)}
      </div>
      <div className="status">
        <div className="label">system</div>
        <div className="row"><span className="dim" style={{ fontSize: 12.5 }}><span className={`lamp ${o?.live_busy ? "on" : ""}`} />workcell</span><span className="num faint" style={{ fontSize: 12 }}>{o?.live_busy ? "running" : "idle"}</span></div>
        {o?.context && <div className="row"><span className="dim" style={{ fontSize: 12.5 }}><span className="lamp ok" />policy</span><span className="mono faint" style={{ fontSize: 11.5 }}>{o.context.agent?.split("+")[0]}</span></div>}
        {o?.context && <div className="row"><span className="dim" style={{ fontSize: 12.5 }}><span className="lamp ok" />benchmark</span><span className="mono faint" style={{ fontSize: 11.5 }}>{o.context.benchmark}</span></div>}
        {cal && <div className="row"><span className="dim" style={{ fontSize: 12.5 }}><span className={`lamp ${cal.ready ? "ok" : ""}`} />judge</span><span className="mono faint" style={{ fontSize: 11.5 }}>AUC {cal.auc?.toFixed(2)}</span></div>}
        <div className="faint mono" style={{ fontSize: 11 }}>{o ? `${o.runs} runs · ${o.episodes.toLocaleString()} episodes` : ""}</div>
      </div>
    </nav>
  );
}

function App() {
  const world = useLocation().pathname.startsWith("/world/");
  return (
    <div className={`shell${world ? " world-shell" : ""}`}>
      <Rail />
      <main className="page">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/live" element={<Live />} />
          <Route path="/operator" element={<Operator />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:runId" element={<RunDetail />} />
          <Route path="/runs/:runId/episodes/:episodeId" element={<Episode />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/research" element={<Research />} />
          <Route path="/research/:id" element={<ResearchSession />} />
          <Route path="/experience" element={<Experience />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/world" element={<Worlds />} />
          <Route path="/world/:stage" element={<WorldStage />} />
          <Route path="*" element={<div className="empty-state">This page does not exist.</div>} />
        </Routes>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </React.StrictMode>,
);
