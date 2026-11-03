"""Video walkthroughs of Studio (1280x800 mp4 with a poster frame each), recorded in headless Chromium driven like a
user, with a visible cursor and captions:

  campaigns   the campaign list, a promoted candidate's cascade and evidence, an LLM campaign that promoted nothing,
              a candidate approved by hand, the rollback form, the A/B arena on the held-out split
  experience  skill libraries with their gate evidence, lesson books with their curation log, an action bank
  research    a research session's turns, submissions and frozen program, the campaign that promoted it, the
              program skill in the library
  world       a stage built into a world, the free view, an action and a goal check by hand, a chat session
  live        a tool-calling agent (a local model through Ollama) running one MuJoCo episode from the Live sandbox
  terminal    `hylo watch --replay` of a recorded tool-calling episode, in a terminal

    uv run --with playwright python examples/03_recordings.py --sources SOURCES.json [--only campaigns,world] [--out DIR]

The scenes read recorded runs named in a sources file (examples/recordings/sources.example.json lists what each
needs); the campaigns scene also runs a fresh MuJoCo campaign. Requirements: Playwright with a Chromium build, the
built web bundle, MUJOCO_GL=osmesa (or egl) for the world scene, an Ollama server with the configured model for live.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "recordings"))
from _common import ROOT, Procs, start_playground  # noqa: E402
import prepare  # noqa: E402
import scenes  # noqa: E402
from rec import record  # noqa: E402

ALL = ("campaigns", "experience", "research", "world", "live", "terminal")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sources", required=True, help="JSON file naming the recorded runs to show")
    ap.add_argument("--only", help="comma-separated scenes (default: all)")
    ap.add_argument("--out", default=str(ROOT / "runs" / "examples" / "recordings"))
    a = ap.parse_args()
    src = json.loads(Path(a.sources).read_text())
    only = a.only.split(",") if a.only else list(ALL)
    out = Path(a.out)
    work = out / "work"
    work.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MUJOCO_GL", "osmesa")
    os.environ.setdefault("PYOPENGL_PLATFORM", os.environ["MUJOCO_GL"])
    procs = Procs(out / "logs")
    results: dict[str, dict] = {}
    try:
        def studio(store: Path, extra: tuple[str, ...] = ()) -> str:
            return start_playground(procs, store, None, None, name=f"playground-{len(procs.procs)}", extra=extra)

        if "campaigns" in only:
            store = prepare.campaigns(work, src.get("campaigns", {}))
            prepare.reset_pending(work)
            results["campaigns"] = record(studio(store), out / "studio-campaigns.mp4", scenes.campaigns)
        if {"experience", "research"} & set(only):
            exp = src.get("experience", {})
            store = prepare.experience(work, exp)
            url = studio(store, ("--sessions", f"research={exp['sessions']}") if exp.get("sessions") else ())
            for name in ("experience", "research"):
                if name in only:
                    results[name] = record(url, out / f"studio-{name}.mp4", getattr(scenes, name))
        if {"world", "live"} & set(only):
            store = prepare.world(work, src.get("world", {}))
            url = studio(store)
            for name in ("world", "live"):
                if name in only:
                    results[name] = record(url, out / f"studio-{name}.mp4", getattr(scenes, name))
        if "terminal" in only:
            t = src["terminal"]
            lines = prepare.watch_lines(work, t["run"], t.get("speed", 8.0))
            page, scene = scenes.terminal(lines, t.get("command", f"uv run hylo watch {t['run']} --replay"))
            results["terminal"] = record(page.as_uri(), out / "terminal-watch.mp4", scene, theme="dark")
    finally:
        procs.stop_all()
    (out / "result.json").write_text(json.dumps({"recorded": results, "at": time.strftime("%Y-%m-%d %H:%M")}, indent=2))
    for name, r in results.items():
        print(f"{name:11s} {r['seconds']:6.1f} s  {r['kb']:6d} KB  {r['file']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
