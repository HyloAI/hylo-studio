"""Research sessions and code-agent runs, read straight from their directories (plain JSON and JSONL files).

A research session directory holds `log.jsonl` (one record per turn, reset, submission and the end; images as
PNG files under images/), `submissions/sub-NN/` (solve.py, results.json), `frozen/<name>/` (the sealed program:
solve.py, program.json, artifact.json) and `summary.json`. Scene-builder runs keep their turns in `turns.jsonl`
with `solve.json` / `build.json`, motion-studio runs in `log.jsonl` (records keyed by `event`) with
`summary.json`, replay runs in `agent_turns.jsonl` with `report.json`. Each of those may hold MP4 videos.

Nothing here imports the code that wrote the files: the formats are read as data, and every field is optional.
Sessions are found under the playground's runs directory and any extra roots (`--sessions`); a session id is its
path relative to its root, prefixed with `<label>:` for an extra root. Files are only served from inside a
discovered session directory, with a fixed set of extensions.
"""

from __future__ import annotations

import json
import os
import re
import threading
from collections.abc import Iterable
from pathlib import Path
from typing import Any

TURN_FILES = ("log.jsonl", "turns.jsonl", "agent_turns.jsonl")
SUMMARY_FILES = ("summary.json", "solve.json", "build.json", "report.json")
SKIP_DIRS = {"blobs", "episodes", "live", "submissions", "frozen", "images", "overlays", "meshes", "registry",
             "__pycache__", "vlm-cache", "node_modules", ".git", ".venv"}
MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
         ".mp4": "video/mp4", ".webm": "video/webm", ".py": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
         ".md": "text/plain; charset=utf-8", ".json": "application/json", ".jsonl": "text/plain; charset=utf-8",
         ".yaml": "text/plain; charset=utf-8", ".xml": "text/plain; charset=utf-8"}
MAX_SOURCE = 400_000                    # bytes of a program's source returned inline
FENCE = re.compile(r"```[a-zA-Z0-9_+-]*\n(.*?)```", re.DOTALL)


def _json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _jsonl(path: Path) -> list[dict[str, Any]]:
    out = []
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue                     # a half-written last line of a live session
                if isinstance(rec, dict):
                    out.append(rec)
    except OSError:
        pass
    return out


def _first_record(path: Path) -> dict[str, Any] | None:
    try:
        with open(path) as fh:
            for line in fh:
                if line.strip():
                    rec = json.loads(line)
                    return rec if isinstance(rec, dict) else None
    except (OSError, ValueError):
        return None
    return None


def _num(v: Any) -> float | None:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def kind_of(d: Path, names: set[str]) -> str | None:
    """What kind of session a directory holds, from its file names (None: not a session)."""
    if "log.jsonl" in names:
        rec = _first_record(d / "log.jsonl")
        if rec is None:
            return None
        if "event" in rec:
            return "motion"
        if "type" in rec or "turn" in rec:
            return "research"
        return None
    if "turns.jsonl" in names:
        return "scene"
    if "agent_turns.jsonl" in names or "report.json" in names:
        return "replay"
    if "results.json" in names and any(n.endswith(".mp4") for n in names):
        return "replay"                          # a gallery of replays: results.json and one video per source
    return None


class Sessions:
    """Discovers sessions under one or more roots and reads them; scans are cached by file mtimes."""

    def __init__(self, roots: Iterable[tuple[str, Path]], campaign_root: Path | None = None) -> None:
        self.roots = [(label, Path(p).resolve()) for label, p in roots]
        self.campaign_root = (campaign_root or self.roots[0][1]).resolve()
        self._cache: dict[str, tuple[tuple, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ discovery and ids
    def _sid(self, label: str, root: Path, d: Path) -> str:
        rel = d.relative_to(root).as_posix() if d != root else "."
        return f"{label}:{rel}" if label else rel

    def _walk(self) -> list[tuple[str, Path, Path, str]]:
        found = []
        for label, root in self.roots:
            if not root.is_dir():
                continue
            base = len(root.parts)
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = sorted(n for n in dirnames if n not in SKIP_DIRS and len(Path(dirpath).parts) - base < 8)
                kind = kind_of(Path(dirpath), set(filenames))
                if kind:
                    found.append((label, root, Path(dirpath), kind))
        return found

    def resolve(self, sid: str) -> tuple[Path, str]:
        """The directory and kind of a session id; KeyError for anything that is not a session inside a root."""
        label, rel = "", sid
        if ":" in sid:
            head, tail = sid.split(":", 1)
            if any(lab == head for lab, _ in self.roots if lab):
                label, rel = head, tail
        root = next((r for lab, r in self.roots if lab == label), None)
        if root is None or not _safe_rel(rel):
            raise KeyError(sid)
        d = (root / rel).resolve()
        if d != root and root not in d.parents:
            raise KeyError(sid)
        if not d.is_dir():
            raise KeyError(sid)
        rel_parts = d.relative_to(root).parts
        if any(p in SKIP_DIRS for p in rel_parts):
            raise KeyError(sid)
        kind = kind_of(d, set(os.listdir(d)))
        if kind is None:
            raise KeyError(sid)
        return d, kind

    def file(self, sid: str, rel: str) -> tuple[Path, str]:
        """A file inside a session directory, with its media type; KeyError if missing, outside or not servable."""
        d, _ = self.resolve(sid)
        if not _safe_rel(rel) or rel == ".":
            raise KeyError(rel)
        f = (d / rel).resolve()
        if d not in f.parents or not f.is_file():
            raise KeyError(rel)
        media = MEDIA.get(f.suffix.lower())
        if media is None:
            raise KeyError(rel)
        return f, media

    # ------------------------------------------------------------------ list
    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            out = []
            for label, root, d, kind in self._walk():
                key = str(d)
                stamp = tuple(_mtime(d / n) for n in (*TURN_FILES, *SUMMARY_FILES, "results.json"))
                cached = self._cache.get(key)
                if cached is None or cached[0] != stamp:
                    cached = (stamp, self._row(label, root, d, kind))
                    self._cache[key] = cached
                out.append(cached[1])
        out.sort(key=lambda r: r.get("started") or 0, reverse=True)
        return out

    def _row(self, label: str, root: Path, d: Path, kind: str) -> dict[str, Any]:
        recs = _jsonl(d / _turn_file(d)) if _turn_file(d) else []
        info = _overview(d, kind, recs)
        return {"id": self._sid(label, root, d), "root": label or "runs", "kind": kind, "dir": str(d), "name": d.name,
                **info}

    # ------------------------------------------------------------------ one session
    def session(self, sid: str) -> dict[str, Any]:
        d, kind = self.resolve(sid)
        tf = _turn_file(d)
        recs = _jsonl(d / tf) if tf else []
        events = [_event(r, d) for r in recs]
        info = _overview(d, kind, recs)
        summary = next((_json(d / n) for n in SUMMARY_FILES if (d / n).exists()), None)
        if summary is None and kind == "replay" and (d / "results.json").exists():
            summary = _json(d / "results.json")
        extra = {n: _json(d / n) for n in ("solve.json", "build.json", "scene.json", "check.json") if (d / n).exists()}
        return {"id": sid, "kind": kind, "dir": str(d), "name": d.name, **info, "turn_file": tf,
                "events": events, "summary": summary, "extra": extra,
                "dev_cases": (summary or {}).get("dev_cases") if isinstance(summary, dict) else None,
                "submissions": _submissions(d, summary, recs) if kind == "research" else [],
                "frozen": _frozen(d, summary) if kind == "research" else [],
                "videos": sorted(p.name for p in d.glob("*.mp4")) + sorted(p.name for p in d.glob("*.webm")),
                "files": sorted(p.name for p in d.iterdir() if p.is_file() and p.suffix.lower() in MEDIA),
                "campaigns": self.campaign_links(d)}

    def campaign_links(self, d: Path) -> list[dict[str, Any]]:
        """Campaign candidates whose evidence names this session directory (`evidence.session`)."""
        out = []
        root = self.campaign_root
        if not root.is_dir():
            return out
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [n for n in dirnames if n not in SKIP_DIRS and not n.startswith("cycle-")]
            if "campaign_state.json" not in filenames or "archive.jsonl" not in filenames:
                continue
            cdir = Path(dirpath)
            state = _json(cdir / "campaign_state.json") or {}
            active = _json(cdir / "active.json") or {}
            for e in _jsonl(cdir / "archive.jsonl"):
                cand = e.get("candidate") or {}
                sess = (cand.get("evidence") or {}).get("session")
                if not isinstance(sess, str):
                    continue
                p = Path(sess)
                p = p if p.is_absolute() else root / p
                try:
                    same = p.resolve() == d
                except OSError:
                    same = False
                if same:
                    out.append({"campaign": cdir.relative_to(root).as_posix(), "name": state.get("name"),
                                "candidate": cand.get("id"), "verdict": e.get("verdict"),
                                "stage_reached": e.get("stage_reached"), "active": active.get("version") == cand.get("id")})
        return out


# ---------------------------------------------------------------------- readers
def _mtime(p: Path) -> float:
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0


def _safe_rel(rel: str) -> bool:
    """A relative POSIX path without '..' segments, backslashes or NUL bytes."""
    if not rel or rel.startswith(("/", "~")) or "\\" in rel or "\x00" in rel or re.match(r"^[A-Za-z]:", rel):
        return False
    return ".." not in rel.split("/")


def _turn_file(d: Path) -> str | None:
    return next((n for n in TURN_FILES if (d / n).exists()), None)


def _is_turn(r: dict[str, Any]) -> bool:
    return r.get("type") == "turn" or ("turn" in r and "type" not in r and "event" not in r)


def _overview(d: Path, kind: str, recs: list[dict[str, Any]]) -> dict[str, Any]:
    """The list row: model, task, dev score, turns, tokens, cost, wall time, stop reason."""
    turns = [r for r in recs if _is_turn(r)]
    s = _json(d / "summary.json") if (d / "summary.json").exists() else None
    s = s if isinstance(s, dict) else {}
    solve = _json(d / "solve.json") if kind == "scene" else None
    solve = solve if isinstance(solve, dict) else {}
    build = _json(d / "build.json") if kind == "scene" else None
    build = build if isinstance(build, dict) else {}
    report = _json(d / "report.json") if kind == "replay" else None
    report = report if isinstance(report, dict) else {}
    end = next((r for r in reversed(recs) if r.get("type") == "end" or r.get("event") == "end"), {})
    start = next((r for r in recs if r.get("event") == "start"), {})

    usage = s.get("usage") or solve.get("usage") or end.get("usage") or report.get("usage")
    if not usage and turns:
        usage = turns[-1].get("usage") if isinstance(turns[-1].get("usage"), dict) else None
    if not usage and turns:
        usage = {"calls": len(turns), "tokens_in": sum(_num(t.get("tokens_in")) or 0 for t in turns),
                 "tokens_out": sum(_num(t.get("tokens_out")) or 0 for t in turns),
                 "cost_usd": sum(_num(t.get("cost_usd")) or 0 for t in turns),
                 "latency_s": round(sum(_num(t.get("latency_s")) or 0 for t in turns), 2)}
    usage = usage or {}

    model = s.get("model") or solve.get("model") or start.get("model") or report.get("model")
    if not model and turns:
        t0 = turns[0]
        model = f"{t0['backend']}:{t0['model']}" if t0.get("backend") and t0.get("model") else t0.get("model")

    dev_cases = s.get("dev_cases") if isinstance(s.get("dev_cases"), list) else []
    task = (s.get("request") or solve.get("instruction") or build.get("task") or report.get("instruction")
            or start.get("request") or (dev_cases[0].get("instruction") if dev_cases and isinstance(dev_cases[0], dict) else None))
    if not task and kind == "research" and turns:
        first = (turns[0].get("prompt") or {}).get("first") if isinstance(turns[0].get("prompt"), dict) else None
        m = re.search(r'"instruction":\s*"([^"]+)"', first or "")
        task = m.group(1) if m else None

    score = None
    if kind == "research":
        subs = s.get("submissions") or [r for r in recs if r.get("type") == "submit"]
        best = max(subs, key=lambda x: (x.get("successes") or 0), default=None) if subs else None
        if best is not None:
            score = {"successes": best.get("successes"), "cases": best.get("cases") or len(dev_cases) or None}
        elif dev_cases:
            score = {"successes": None, "cases": len(dev_cases)}         # nothing was submitted
    elif kind == "scene" and "success" in solve:
        score = {"successes": int(bool(solve.get("success"))), "cases": 1}
    if kind == "replay" and not task and (d / "results.json").exists():
        res = _json(d / "results.json")
        if isinstance(res, dict):
            task = f"{len(res)} replays: " + ", ".join(sorted(res)[:4]) + (" …" if len(res) > 4 else "")

    wall = _num(s.get("elapsed_s")) or _num(s.get("wall_s")) or _num(solve.get("wall_s")) or _num(end.get("wall_s"))
    stamps = [r["t"] for r in recs if _num(r.get("t"))]
    if wall is None and len(stamps) > 1:
        wall = round(stamps[-1] - stamps[0], 1)
    started = stamps[0] if stamps else max((_mtime(d / n) for n in (*TURN_FILES, *SUMMARY_FILES)), default=0)

    stopped = s.get("stopped") or end.get("stopped") or solve.get("reason") or solve.get("status")
    if not stopped:
        stopped = "no summary (interrupted?)" if turns else None
    budget = s.get("budget") or start.get("budget")
    return {"model": model, "task": task, "score": score, "turns": s.get("turns") or solve.get("turns") or len(turns),
            "usage": usage, "wall_s": wall, "stopped": stopped, "started": started, "budget": budget,
            "complete": bool(s or solve or report), "session": s.get("session"), "config": s.get("config"),
            "benchmark": (s.get("benchmark") or {}).get("id") if isinstance(s.get("benchmark"), dict) else s.get("benchmark"),
            "robot": s.get("robot") or start.get("robot")}


def _event(r: dict[str, Any], d: Path) -> dict[str, Any]:
    """One timeline entry: the record as written, with `kind` and image references the page can load."""
    kind = r.get("type") or r.get("event") or ("turn" if "turn" in r else "note")
    e = {k: v for k, v in r.items() if k not in ("type", "event", "images")}
    e["kind"] = kind
    if kind == "turn":
        reply, code = r.get("reply") or "", r.get("code")
        e["text"] = FENCE.sub("", reply).strip() if code else reply.strip()      # the code is shown on its own
    imgs = []
    for i, img in enumerate(r.get("images") or []):
        if isinstance(img, str):
            img = {"note": img}
        if not isinstance(img, dict):
            continue
        f = img.get("file")
        ok = isinstance(f, str) and _inside(d, f)
        imgs.append({"note": img.get("note") or f"image {i + 1}", "file": f if ok else None, "shape": img.get("shape")})
    if imgs:
        e["images"] = imgs
    return e


def _inside(d: Path, rel: str) -> bool:
    try:
        f = (d / rel).resolve()
    except OSError:
        return False
    return d in f.parents and f.is_file()


def _source(f: Path) -> str | None:
    try:
        return f.read_text(errors="replace")[:MAX_SOURCE] if f.is_file() else None
    except OSError:
        return None


def _submissions(d: Path, summary: Any, recs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every submission with its per-case outcomes (summary.json, else the log), outputs and source file."""
    s = summary if isinstance(summary, dict) else {}
    by_n: dict[int, dict[str, Any]] = {}
    for r in recs:
        if r.get("type") == "submit" and isinstance(r.get("submission"), int):
            by_n[r["submission"]] = {"submission": r["submission"], "successes": r.get("successes"),
                                     "cases": r.get("cases"), "outcomes": r.get("results") or [], "t": r.get("t")}
    for x in s.get("submissions") or []:
        n = x.get("submission")
        if isinstance(n, int):
            base = by_n.setdefault(n, {"submission": n, "outcomes": []})
            base.update({k: x[k] for k in ("successes", "cases") if k in x})
            if not base["outcomes"]:
                base["outcomes"] = x.get("outcomes") or []
    frozen_n = (s.get("frozen") or {}).get("submission") if isinstance(s.get("frozen"), dict) else None
    out = []
    for n in sorted(by_n):
        sub = by_n[n]
        sd = d / "submissions" / f"sub-{n:02d}"
        res = _json(sd / "results.json") if (sd / "results.json").exists() else None
        if isinstance(res, dict) and res.get("results"):
            known = {o.get("case"): o for o in sub["outcomes"] if isinstance(o, dict)}
            sub["outcomes"] = [{**known.get(o.get("case"), {}), **o} for o in res["results"] if isinstance(o, dict)]
        sub["source"] = f"submissions/sub-{n:02d}/solve.py" if (sd / "solve.py").is_file() else None
        sub["frozen"] = n == frozen_n
        out.append(sub)
    return out


def _frozen(d: Path, summary: Any) -> list[dict[str, Any]]:
    """The sealed programs under frozen/: source, digest, program.json and artifact.json."""
    s = summary if isinstance(summary, dict) else {}
    out = []
    fz = d / "frozen"
    if not fz.is_dir():
        return out
    for p in sorted(fz.iterdir()):
        if not p.is_dir():
            continue
        prog = _json(p / "program.json") or {}
        art = _json(p / "artifact.json") or {}
        entry = prog.get("file") if isinstance(prog.get("file"), str) else "solve.py"
        src_file = (p / entry).resolve()
        src = _source(src_file) if p.resolve() in src_file.parents else None
        meta = s.get("frozen") if isinstance(s.get("frozen"), dict) else {}
        out.append({"name": p.name, "digest": art.get("digest") or meta.get("digest"), "file": f"frozen/{p.name}/{entry}",
                    "source": src, "lines": src.count("\n") + 1 if src else 0, "program": prog, "artifact": art,
                    "submission": prog.get("submission") or meta.get("submission")})
    return out
