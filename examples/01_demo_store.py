"""A self-contained demo store with every Studio page populated, and the playground on it, in under a minute.

Builds, with the commands a user would type and no recorded data from elsewhere:
- two scorecards of the mujoco-reach protocol (`hylo bench run`, 100 episodes each) and their paired comparison;
- an improvement campaign on MuJoCo planar reach (`hylo evolve run`: cycles, candidates, gate, promotion);
- a sealed artifact (`hylo learn`, a k-NN policy from the campaign's development runs);
- workcell episodes on the simulated arm (`hylo serve policy` + `hylo serve workcell`, operator verdicts), with
  camera frames for the replay;
then starts `hylo playground` on the store with that workcell and policy server behind the Operator page, starts
one job from the Jobs API, and checks every page's API (status, item counts, response time). Without --check it
keeps everything running until Ctrl-C.

    uv run python examples/01_demo_store.py [--quick] [--check] [--out DIR] [--port 8765]

Runtime: about 40 s to a ready playground (--quick: about 30 s). The Experience page's Skills and Lessons tabs stay
empty (they come from steering campaigns and an LLM reflector); its Artifacts tab has the sealed artifact.
Requirements: the workspace venv (hylo-bench, hylo-env-mujoco, hylo-evolve, hylo-learn, hylo-serve, hylo-playground)
and the built web bundle (cd web && npm install --ignore-scripts && npm run build); CPU only.
"""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import time
from pathlib import Path

from _common import ROOT, Procs, build_store, http, start_playground, wait_job

SLUG = "demo-store"
PAGES = {                         # page -> the API calls it makes on load
    "Overview": ["/api/overview"], "Runs": ["/api/runs"], "Compare": ["/api/runs", "/api/compare?a={a}&b={b}"],
    "Campaigns": ["/api/campaigns", "/api/campaign?id=evolve/mujoco-reach-gain"],
    "Experience": ["/api/skills", "/api/lessons", "/api/memories", "/api/artifacts"], "Jobs": ["/api/jobs", "/api/configs"],
    "Live": ["/api/configs"], "Operator": ["/api/me", "/api/workcells", "/api/policies"],
}


def count(x) -> int | None:
    if isinstance(x, list):
        return len(x)
    if isinstance(x, dict):
        for k in ("runs", "pairs", "cycles", "entries"):
            if k in x:
                return x[k] if isinstance(x[k], int) else len(x[k])
    return None


def check_pages(url: str, a: str, b: str, repeats: int = 5) -> list[dict]:
    rows = []
    for page, calls in PAGES.items():
        ms, codes, counts = [], [], []
        for call in calls:
            path = call.format(a=a, b=b)
            times = []
            for _ in range(repeats):
                t = time.perf_counter()
                code, body = http("GET", url + path)
                times.append((time.perf_counter() - t) * 1000)
            ms.append(statistics.median(times))
            codes.append(code)
            counts.append(count(body))
        spa = http("GET", url + "/" + page.lower())[0]
        rows.append({"page": page, "api_calls": len(calls), "all_200": all(c == 200 for c in codes) and spa == 200,
                     "items": counts, "api_p50_ms": round(sum(ms), 1)})
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("--quick", action="store_true", help="fewer workcell steps")
    ap.add_argument("--check", action="store_true", help="check every page's API, then stop (no interactive server)")
    ap.add_argument("--out", default=str(ROOT / "runs" / "examples" / SLUG), help="the demo store (the playground's --repo)")
    ap.add_argument("--port", type=int, default=None, help="playground port (default: a free one)")
    a = ap.parse_args()
    store = Path(a.out).resolve()
    if store.exists():
        shutil.rmtree(store)
    store.mkdir(parents=True)
    procs = Procs(store / "logs")
    t0 = time.monotonic()
    try:
        print(f"building the demo store in {store}")
        built = build_store(store, procs, quick=a.quick)
        t = time.monotonic()
        url = start_playground(procs, store, built["policy_url"], built["workcell_url"], a.port)
        playground_s = time.monotonic() - t
        code, job = http("POST", url + "/api/jobs", {"kind": "run", "args": {"config": "examples/configs/mujoco_reach.yaml"}})
        job = wait_job(url, job["id"]) if code == 200 else {"status": f"HTTP {code}"}
        ready_s = time.monotonic() - t0
        runs = http("GET", url + "/api/runs")[1]
        bench = sorted(r["run_id"] for r in runs if r["run_id"].startswith("mujoco-reach--"))
        rows = check_pages(url, bench[0], bench[1])
        ov = http("GET", url + "/api/overview")[1]
        print(f"\nplayground ready on {url} after {ready_s:.1f} s (store {built['build_s']:.1f} s, server {playground_s:.1f} s, "
              f"job {job['status']})\n")
        cols = ["page", "api_calls", "all_200", "items", "api_p50_ms"]
        w = [max(len(c), *(len(str(r[c])) for r in rows)) for c in cols]
        print("  ".join(c.ljust(w[i]) for i, c in enumerate(cols)))
        print("  ".join("-" * x for x in w))
        for r in rows:
            print("  ".join(str(r[c]).ljust(w[i]) for i, c in enumerate(cols)))
        summary = {"ready_s": round(ready_s, 1), "build_s": built["build_s"], "playground_start_s": round(playground_s, 1),
                   "steps_s": built["steps_s"], "runs": ov["runs"], "episodes": ov["episodes"],
                   "campaigns": len(ov["campaigns"]), "artifacts": ov["artifacts"], "job": job.get("status"),
                   "all_pages_200": all(r["all_200"] for r in rows), "bench_compare": built["bench_compare"]}
        print(f"\n{ov['runs']} runs, {ov['episodes']} episodes, {len(ov['campaigns'])} campaign, {ov['artifacts']} artifact; "
              f"every page answered 200: {summary['all_pages_200']}")
        (store / "result.json").write_text(json.dumps({"example": SLUG, "quick": a.quick, "url": url, "summary": summary,
                                                       "pages": rows, "workcell_episodes": built["workcell_episodes"]},
                                                      indent=2, default=str))
        print(f"result: {store / 'result.json'}")
        if not a.check:
            print(f"\nopen {url}  (Ctrl-C stops the playground, the workcell and the policy server)")
            while True:
                time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        procs.stop_all()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
