// Thin client for the hylo-playground backend (studio/packages/hylo-playground). Responses are plain JSON from the runs directory.
import { useEffect, useState } from "react";

const token = new URLSearchParams(window.location.search).get("token") || localStorage.getItem("hylo-token") || "";
if (token) localStorage.setItem("hylo-token", token);

function withToken(path: string): string {
  if (!token) return path;
  return path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

export async function get<T = any>(path: string): Promise<T> {
  const r = await fetch(withToken(path));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

export async function post<T = any>(path: string, body: unknown = {}): Promise<T> {
  const r = await fetch(withToken(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

export function frameUrl(runId: string, episodeId: string, obs: number, cam: string): string {
  return withToken(`/api/runs/${encodeURIComponent(runId)}/episodes/${encodeURIComponent(episodeId)}/frame?obs=${obs}&cam=${cam}`);
}

/** A file inside a research session or code-agent run directory (images, videos, program sources). */
export function sessionFileUrl(id: string, path: string): string {
  return withToken(`/api/research/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`);
}

export function liveSocket(): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(withToken(`${proto}://${window.location.host}/api/live`));
}

/** Fetch on mount / when `path` changes. Returns [data, error, reload]. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []): [T | null, string | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setErr(null);
    get<T>(path).then((d) => alive && setData(d)).catch((e) => alive && setErr(String(e.message || e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);
  return [data, err, () => setN((x) => x + 1)];
}

export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(d)}%`);
export const shortTask = (t: string) => (t || "").split("/").pop()!.replace(/_/g, " ");
export const ago = (ts: number | string) => {
  const t = typeof ts === "number" ? ts * (ts < 1e12 ? 1000 : 1) : Date.parse(ts);
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 90) return "just now";
  if (s < 3600 * 1.5) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
export const kTok = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
export const dur = (s: number | null | undefined) => (s === null || s === undefined ? "–" : s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)} s` : s < 3600 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
export const usd = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
