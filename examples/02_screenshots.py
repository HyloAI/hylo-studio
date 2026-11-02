"""Screenshots of every Studio page (1440x900 PNG, at most 500 KB each) into examples/assets/.

Builds the demo store of 01_demo_store.py and starts the playground on it, with a policy server and the
simulated-arm workcell. The interactive pages are driven like a user would in headless Chromium: Jobs (a
`hylo run` job and its log), Live (one MuJoCo episode run from the page), Operator (an episode started, its reset
confirmed, captured mid-episode). The read-only pages (Overview, Runs, a run, an episode replay, Compare,
Campaigns, a campaign, Experience) come from `--rich-repo` when given (a working directory with recorded runs,
e.g. LIBERO-10 episodes with camera frames; it is only read) and from the demo store otherwise. The Research
pages (the session list, one research session's timeline, its frozen program, a scene-builder run's video) come
from `--research-repo` (a working directory whose runs/ holds research sessions; only read), with extra session
roots from `--research-sessions`; `--only-research` takes just those, without the demo store.

    uv run --with playwright python examples/02_screenshots.py [--rich-repo DIR] [--research-repo DIR] [--quick] [--out DIR]

Runtime: about 90 s. Requirements: Playwright with a Chromium build (`uv run --with playwright python -m
playwright install chromium`, or an existing ~/.cache/ms-playwright), the built web bundle, the workspace venv.
`--rich-repo` defaults to $HYLO_SCREENSHOT_REPO; `--research-repo` to $HYLO_RESEARCH_REPO, else the directory above
this repository when its runs/ holds the research session RESEARCH_SESSION.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import time
import urllib.parse
from pathlib import Path

from _common import ROOT, Procs, build_store, http, start_playground, wait_job

SLUG = "screenshots"
ASSETS = ROOT / "examples" / "assets"
MAX_BYTES = 500_000
RICH_RUN = "l10-ab-critic-search_val-73dc98eaf0df4917-45b6ba"       # SmolVLA + chunk critic on LIBERO-10, with frames
RICH_COMPARE = ("l10-ab-vote-search_val-62806929c2e37735-7172cb", RICH_RUN)
RICH_CAMPAIGN = "evolve/libero10-llm"
RESEARCH_SESSION = "campaign/research/base-r0"                    # a research session whose program a campaign promoted
RESEARCH_EXAMPLES = "harness/adapters/hylo-code-agents/examples"  # scene-builder / motion-studio / replay runs
RESEARCH_SCENE = "examples:scenes/ball_cup"
RESEARCH_IMAGES = "research/qwen-press_by_number"                # a session whose model asked for camera views


def default_research_repo() -> str | None:
    if os.environ.get("HYLO_RESEARCH_REPO"):
        return os.environ["HYLO_RESEARCH_REPO"]
    up = ROOT.parent
    return str(up) if (up / "runs" / RESEARCH_SESSION / "log.jsonl").exists() else None


def research_shots(page, base: str, save, session: str, scene: str | None, images: str | None = RESEARCH_IMAGES) -> None:
    """The Research list, one session (top, a turn with code and output, the frozen program), a turn with the
    camera views the model was shown, a scene run's video."""
    q = urllib.parse.quote
    page.goto(base + "/research", wait_until="networkidle")
    page.wait_for_timeout(1000)
    save("research.png", base, "/research")
    path = f"/research/{q(session, safe='')}"
    page.goto(base + path, wait_until="networkidle")
    page.wait_for_timeout(1500)
    save("research-session.png", base, path)
    # the first turn that ran code and printed something, scrolled to the top of the viewport
    turn = page.locator("article.turn:has(pre.terminal):has(pre.code)").first
    turn.evaluate("e => e.scrollIntoView({block: 'start'})")
    page.wait_for_timeout(500)
    save("research-turn.png", base, path + "#turn", top=False)
    page.get_by_role("button", name="Frozen program").click()
    page.wait_for_timeout(800)
    page.locator(".tabs").evaluate("e => e.scrollIntoView({block: 'start'})")
    page.wait_for_timeout(300)
    save("research-program.png", base, path + " (frozen program)", top=False)
    ids = {r["id"] for r in http("GET", base + "/api/research/sessions")[1]}
    if images in ids:
        path = f"/research/{q(images, safe='')}"
        page.goto(base + path, wait_until="networkidle")
        img = page.locator(".shots figure").first
        img.evaluate("e => e.scrollIntoView({block: 'center'})")
        page.wait_for_timeout(1000)                          # the image loads lazily: scroll again once it has a size
        img.evaluate("e => e.scrollIntoView({block: 'center'})")
        page.wait_for_timeout(300)
        save("research-images.png", base, path + "#images", top=False)
    if scene:
        path = f"/research/{q(scene, safe='')}"
        page.goto(base + path, wait_until="networkidle")
        page.get_by_role("button", name="Video", exact=False).click()
        page.locator(".tabs").evaluate("e => e.scrollIntoView({block: 'start'})")
        page.locator("video").first.evaluate("v => new Promise(r => { v.currentTime = Math.min(4, (v.duration || 8) / 2); v.onseeked = () => r(); setTimeout(r, 3000); })")
        page.wait_for_timeout(800)
        save("research-scene.png", base, path + " (video)", top=False)


def shrink(png: bytes) -> tuple[bytes, str]:
    """Keep a screenshot under MAX_BYTES: lossless first, then a 256-colour palette (UI colours survive it)."""
    from PIL import Image

    if len(png) <= MAX_BYTES:
        return png, "lossless"
    img = Image.open(io.BytesIO(png)).convert("RGB")
    for colors in (256, 128, 64):
        buf = io.BytesIO()
        img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(buf, "PNG", optimize=True)
        if buf.tell() <= MAX_BYTES:
            return buf.getvalue(), f"{colors}-colour palette"
    raise RuntimeError("screenshot stays above 500 KB")


def pick(url: str, run: str | None, compare: tuple[str, str] | None, campaign: str | None) -> dict:
    runs = http("GET", url + "/api/runs")[1]
    ids = {r["run_id"] for r in runs}
    if run not in ids:                                   # the demo store: the workcell run has camera frames
        run = next((r["run_id"] for r in runs if r["split"] == "deployment"), runs[0]["run_id"])
    if not compare or not set(compare) <= ids:
        bench = sorted((r for r in runs if r["run_id"].startswith("mujoco-reach--")), key=lambda r: r["success"] or 0)
        compare = (bench[0]["run_id"], bench[-1]["run_id"])
    camps = [c["id"] for c in http("GET", url + "/api/campaigns")[1]]
    if campaign not in camps:
        campaign = camps[0]
    samples = http("GET", url + f"/api/runs/{urllib.parse.quote(run)}")[1]["samples"]
    episode = next((s["episode_id"] for s in samples if s["status"] == "success"), samples[0]["episode_id"])
    return {"run": run, "episode": episode, "compare": compare, "campaign": campaign}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("--rich-repo", default=os.environ.get("HYLO_SCREENSHOT_REPO"),
                    help="working directory with recorded runs for the read-only pages (only read)")
    ap.add_argument("--research-repo", default=default_research_repo(),
                    help="working directory whose runs/ holds research sessions, for the Research pages (only read)")
    ap.add_argument("--research-sessions", default=RESEARCH_EXAMPLES,
                    help="extra session root under --research-repo, labelled 'examples' (code-agent runs)")
    ap.add_argument("--only-research", action="store_true", help="take only the Research screenshots (no demo store)")
    ap.add_argument("--quick", action="store_true", help="fewer workcell steps while building the demo store")
    ap.add_argument("--out", default=str(ASSETS), help="where the PNGs go")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright

    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    work = ROOT / "runs" / "examples" / SLUG
    store = work / "store"
    procs = Procs(work / "logs")
    shots, t0 = [], time.monotonic()
    built, sel, demo = {"build_s": None}, None, ""
    research, scene = None, None
    try:
        if a.research_repo:
            rrepo = Path(a.research_repo).resolve()
            extra = (rrepo / a.research_sessions).resolve() if a.research_sessions else None
            args = ["--sessions", f"examples={extra}"] if extra and extra.is_dir() else []
            research = start_playground(procs, rrepo, None, None, name="research", extra=args)
            scene = RESEARCH_SCENE if args and (extra / RESEARCH_SCENE.split(":", 1)[1]).is_dir() else None
        elif a.only_research:
            raise SystemExit("--only-research needs --research-repo (or $HYLO_RESEARCH_REPO)")
        if a.only_research:
            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport={"width": 1440, "height": 900}, color_scheme="light", device_scale_factor=1)
                research_shots(page, research, make_save(page, out, shots, demo), RESEARCH_SESSION, scene)
                browser.close()
            return finish(work, out, a, sel, shots, t0, built)
        if store.exists():
            shutil.rmtree(store)
        store.mkdir(parents=True)
        built = build_store(store, procs, quick=a.quick)
        demo = start_playground(procs, store, built["policy_url"], built["workcell_url"])
        code, job = http("POST", demo + "/api/jobs", {"kind": "run", "args": {"config": "examples/configs/mujoco_reach.yaml"}})
        wait_job(demo, job["id"])
        rich = start_playground(procs, Path(a.rich_repo).resolve(), None, None, name="rich") if a.rich_repo else demo
        sel = pick(rich, RICH_RUN, RICH_COMPARE, RICH_CAMPAIGN) if a.rich_repo else pick(demo, None, None, None)
        q = urllib.parse.quote
        static = [
            ("overview.png", rich, "/"), ("runs.png", rich, "/runs"), ("run.png", rich, f"/runs/{q(sel['run'])}"),
            ("episode.png", rich, f"/runs/{q(sel['run'])}/episodes/{q(sel['episode'])}"),
            ("compare.png", rich, f"/compare?a={q(sel['compare'][0])}&b={q(sel['compare'][1])}"),
            ("campaigns.png", rich, "/campaigns"), ("campaign.png", rich, f"/campaigns/{q(sel['campaign'], safe='')}"),
            ("experience.png", rich, "/experience"),
        ]
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900}, color_scheme="light", device_scale_factor=1)

            save = make_save(page, out, shots, demo)

            for name, base, path in static:
                page.goto(base + path, wait_until="networkidle")
                page.wait_for_timeout(2500)                     # frames and charts load after the first paint
                save(name, base, path)

            # Jobs: the job started above, with its log open
            page.goto(demo + "/jobs", wait_until="networkidle")
            page.locator("tr.click").first.click()
            page.wait_for_timeout(1500)
            save("jobs.png", demo, "/jobs")

            # Live: one MuJoCo planar-reach episode run from the page
            page.goto(demo + "/live", wait_until="networkidle")
            page.get_by_role("button", name="Run episode").click()
            page.get_by_text("Open the replay").wait_for(timeout=90_000)
            page.wait_for_timeout(1000)
            save("live.png", demo, "/live")

            # Operator: start an episode on the simulated arm, confirm the reset, capture it mid-episode
            page.goto(demo + "/operator", wait_until="networkidle")
            page.wait_for_timeout(2500)                          # the workcell list is polled every 2 s
            page.fill("#op-instr", "wave the shoulder")
            page.get_by_role("button", name="Start episode").click()
            page.get_by_role("button", name="Scene is reset").click(timeout=30_000)
            page.wait_for_timeout(4000)
            save("operator.png", demo, "/operator")

            # Research: the session list, a research session and a scene-builder run, from --research-repo
            if research:
                research_shots(page, research, save, RESEARCH_SESSION, scene)
            browser.close()
    finally:
        procs.stop_all()
    return finish(work, out, a, sel, shots, t0, built)


def make_save(page, out: Path, shots: list, demo: str):
    def save(name: str, base: str, path: str, top: bool = True) -> None:
        # the event logs scroll themselves into view, which scrolls the page: show its top (unless asked not to)
        if top:
            page.evaluate("document.querySelectorAll('.page').forEach(e => e.scrollTop = 0)")
        data, how = shrink(page.screenshot())
        (out / name).write_bytes(data)
        source = "demo" if base == demo else "research" if name.startswith("research") else "rich"
        shots.append({"file": name, "source": source, "path": path, "bytes": len(data), "encoding": how})
        print(f"  {name:<22} {len(data) / 1000:6.0f} KB  {how:<18} {base}{path}")
    return save


def finish(work: Path, out: Path, a, sel, shots: list, t0: float, built: dict) -> int:
    result = {"example": SLUG, "rich_repo": a.rich_repo, "research_repo": a.research_repo, "selection": sel,
              "screenshots": shots, "runtime_s": round(time.monotonic() - t0, 1), "store_build_s": built["build_s"]}
    work.mkdir(parents=True, exist_ok=True)
    (work / "result.json").write_text(json.dumps(result, indent=2))
    print(f"\n{len(shots)} screenshots in {out} ({result['runtime_s']:.0f} s); largest "
          f"{max(s['bytes'] for s in shots) / 1000:.0f} KB\nresult: {work / 'result.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
