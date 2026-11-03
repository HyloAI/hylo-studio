"""The six recordings, each a function `scene(page, rec, url) -> start time`. Names of the campaigns, stages and
sessions they open are those of sources.example.json."""

from __future__ import annotations

import html
import json
import time
import urllib.request
from pathlib import Path

PROMOTED = "evolve/planar-reach-noise"        # a campaign whose candidate passed the gate
LLM = "evolve/libero10-llm"                   # an LLM-proposer campaign that promoted nothing
FRESH = "evolve/mujoco-reach-gain"            # the fresh campaign, waiting for approval
SESSION = "base-r0"                           # the research session whose program a campaign promoted
PROGRAM_SKILL = "stack@1"
STAGE, CHAT_STAGE = "arms", "demo1"
ACTION = '{"action_id": "above_cube", "robot": "panda", "kind": "tcp", "position": [0.5, -0.15, 0.6], "duration_s": 2}'
GOAL = '{"op": "near", "a": "cube", "b": "plate", "max_m": 0.05}'


def _get(url: str):
    return json.loads(urllib.request.urlopen(url, timeout=30).read())


def _row(page, text):
    return page.locator("tr.click", has_text=text).first


def _tab(page, name):
    return page.locator("div.tabs button", has_text=name).first


def _link_or_text(page, name):
    link = page.get_by_role("link", name=name)
    return link.first if link.count() else page.locator(f"text={name}").first


# ---------------------------------------------------------------------------------------------- self-improvement
def campaigns(page, r, url):
    runs = [x for x in _get(url + "/api/runs") if x.get("group", "").startswith(FRESH) and "heldout" in x["run_id"]]
    parent = next(x["run_id"] for x in runs if "-parent-" in x["run_id"])
    cand = next(x["run_id"] for x in runs if "-cand-" in x["run_id"])
    page.goto(url + "/campaigns", wait_until="networkidle")
    r.wait(500)
    start = time.monotonic()
    r.caption("<b>Self-improvement</b> · every campaign, the proposer it uses, and where it stands", 2600)
    r.to(_row(page, PROMOTED))
    r.caption("A campaign on MuJoCo planar reach: candidates change the policy's sampling noise", 1600)
    r.click(_row(page, PROMOTED), after=900)
    page.wait_for_load_state("networkidle")
    r.caption("Every candidate is drawn as its path: <b>early check → search_val → gate → verdict</b>", 2800)
    r.scroll(260, 1000)
    r.wait(1600)
    r.caption("The promoted candidate: its config patch and the gate's evidence", 1200)
    r.click(page.get_by_role("button", name="▸ patch and evidence").last, after=600)
    r.scroll(420, 1400)
    r.wait(2200)
    r.scroll(700, 1400)
    r.caption("Held-out results are reported only, never used to choose; the <b>ledger</b> records every promotion", 3000)
    r.click(page.get_by_role("link", name="Self-improvement").first, after=900)
    r.caption("LIBERO-10 with a frozen SmolVLA: a language model proposed steering changes", 1400)
    r.click(_row(page, LLM), after=900)
    page.wait_for_load_state("networkidle")
    r.caption("Screened on search_val, tested at the gate, <b>none promoted</b>: the gate decides, not the proposer", 3200)
    r.scroll(380, 1400)
    r.wait(1800)
    r.click(page.get_by_role("link", name="Self-improvement").first, after=900)
    r.to(_row(page, FRESH))
    r.caption("This campaign runs with <b>manual approval</b>: a candidate passed the gate and waits", 2000)
    r.click(_row(page, FRESH), after=900)
    page.wait_for_load_state("networkidle")
    r.wait(800)
    r.caption("Review before promoting: the gate's verdict and the held-out report", 2000)
    r.click(page.get_by_role("button", name="Review and approve"), after=800)
    r.caption("Promote? It becomes the campaign's active configuration", 1800)
    r.click(page.get_by_role("button", name="Promote", exact=True), after=1400)
    r.caption("Promoted, and recorded in the ledger with who approved it", 2200)
    r.scroll(900, 1600)
    r.wait(1800)
    r.scroll(-1600, 1200)
    r.click(page.get_by_role("button", name="Roll back…"), after=600)
    r.caption("Every promotion can be undone; a rollback needs a reason, recorded in the ledger", 600)
    r.click(page.locator("#reason"), after=200)
    r.type("regression seen on the robot", delay=45)
    r.wait(1400)
    r.click(page.get_by_role("button", name="Cancel"), after=700)
    r.caption("<b>A/B arena</b>: the parent and the promoted version, paired on the same held-out initial states", 600)
    page.goto(url + f"/compare?a={parent}&b={cand}", wait_until="networkidle")
    r.wait(2600)
    r.caption("The same test the gate uses: an exact one-sided McNemar test on the pairs only one of them won", 3000)
    r.wait(2600)
    r.caption(None, 600)
    return start


# ---------------------------------------------------------------------------------------------- experience
def experience(page, r, url):
    page.goto(url + "/experience", wait_until="networkidle")
    r.wait(600)
    start = time.monotonic()
    r.caption("<b>Experience</b> · what the agents have learned, each item with its evidence", 2600)
    r.to(page.locator("td.num", has_text="pts").first)
    r.caption("A skill becomes <b>verified</b> only through its gate: the effect, wins and losses on the gate split", 3200)
    r.scroll(320, 1200)
    r.wait(800)
    r.caption("Proposed and refuted skills stay in the library, so proposers do not suggest them again", 2800)
    r.scroll(420, 1400)
    r.caption("A <b>program skill</b>: a sealed program a code agent can call, with the campaign that promoted it", 3000)
    r.scroll(-1200, 900)
    r.click(_tab(page, "Lessons"), after=900)
    r.caption("<b>Lessons</b>: short notes for proposers, with helpful and harmful counts from outcomes", 3000)
    r.scroll(380, 1400)
    r.caption("The curation log: every add, upvote and downvote, with the source that caused it", 3000)
    r.scroll(500, 1400)
    r.wait(1200)
    r.scroll(-1400, 800)
    r.click(_tab(page, "Action memory"), after=900)
    r.caption("<b>Action memory</b>: a frozen bank of verified motion segments, identified by its digest", 3200)
    r.wait(1600)
    r.caption(None, 500)
    return start


# ---------------------------------------------------------------------------------------------- research to skill
def research(page, r, url):
    page.goto(url + "/research", wait_until="networkidle")
    r.wait(600)
    start = time.monotonic()
    r.caption("<b>Research</b> · a model develops a program turn by turn on development cases", 2600)
    r.click(_row(page, SESSION), after=1200)
    page.wait_for_load_state("networkidle")
    r.caption("Each turn: the code it wrote, what ran on the robot, and what it saw", 2600)
    r.scroll(500, 1600)
    r.wait(1200)
    r.scroll(600, 1600)
    r.wait(1000)
    r.scroll(-1100, 900)
    r.click(_tab(page, "Submissions"), after=900)
    r.caption("Submissions are scored on development cases; the best one is frozen", 2800)
    r.scroll(400, 1400)
    r.wait(800)
    r.scroll(-400, 600)
    r.click(_tab(page, "Frozen program"), after=900)
    r.caption("The frozen program: a sealed artifact with a digest, which nothing can change", 2800)
    r.scroll(500, 1600)
    r.wait(800)
    r.scroll(-500, 700)
    link = page.get_by_role("link", name="open the campaign →").first
    if link.count():
        r.caption("A campaign then compares it with the previous version through the gate", 1200)
        r.click(link, after=1200)
        page.wait_for_load_state("networkidle")
        r.caption("The code candidate passed early check, search_val and the gate, and was <b>promoted</b>", 3200)
        r.scroll(300, 1200)
        r.wait(1400)
    page.goto(url + "/experience", wait_until="networkidle")
    r.wait(500)
    r.to(page.locator("tr", has_text=PROGRAM_SKILL).first)
    r.caption("Promoted, it becomes a <b>verified program skill</b>, found by similar instructions and called as "
              "skills.&lt;name&gt;(robot)", 3600)
    r.caption(None, 500)
    return start


# ---------------------------------------------------------------------------------------------- world
def world(page, r, url):
    page.goto(url + "/world", wait_until="networkidle")
    r.wait(600)
    start = time.monotonic()
    r.caption("<b>World</b> · stages: scenes as data, every revision kept", 2400)
    r.click(_link_or_text(page, STAGE), after=1200)
    page.wait_for_load_state("networkidle")
    r.caption("A stage lists entities with poses: a table, a cube, a plate, robots named by their pack", 2800)
    r.click(page.get_by_role("button", name="Build world"), after=500)
    r.caption("<b>Build</b>: the newest revision becomes a MuJoCo world with a new generation", 600)
    page.wait_for_selector("img[alt='world view']", timeout=120_000)
    r.wait(2600)
    b = page.locator("img[alt='world view']").bounding_box()
    cx, cy = b["x"] + b["width"] * 0.5, b["y"] + b["height"] * 0.5
    r.caption("A free view of the world: drag to orbit, wheel to zoom", 400)
    r.move(cx - 120, cy, 600)
    page.mouse.down()
    r.move(cx + 140, cy - 30, 1800)
    page.mouse.up()
    r.wait(1400)
    for _ in range(3):
        page.mouse.wheel(0, -120)
        r.wait(500)
    r.wait(1400)
    areas = page.locator("textarea.mono")
    r.caption("An action by hand: move the Panda's tool point above the cube", 400)
    r.fill(areas.nth(0), ACTION)
    r.click(page.get_by_role("button", name="Run action"), after=500)
    r.caption("The action names the world generation it was decided on; the <b>receipt</b> is measured by the simulation", 600)
    page.wait_for_selector("pre.json", timeout=120_000)
    r.wait(3200)
    r.caption("A goal check: is the cube within 5 cm of the plate?", 400)
    r.fill(areas.nth(1), GOAL)
    r.click(page.get_by_role("button", name="Check goal"), after=1200)
    r.to(page.locator("pre.json"))
    r.caption("Not yet: the check reports what was expected, what was measured, and a <b>reason code</b>", 3400)
    r.click(page.get_by_role("link", name="World").first, after=1000)
    r.click(_link_or_text(page, CHAT_STAGE), after=1600)
    page.wait_for_load_state("networkidle")
    r.caption("A recorded chat session: a local model built this stage through the same tools", 2600)
    r.scroll(600, 1800)
    r.caption("Every tool call, its result and the view after each action: trust these, not the model's own summary", 3000)
    r.scroll(900, 2400)
    r.wait(1600)
    r.caption(None, 500)
    return start


# ---------------------------------------------------------------------------------------------- live agent
def live(page, r, url):
    page.goto(url + "/live", wait_until="networkidle")
    r.wait(800)
    start = time.monotonic()
    r.caption("<b>Live sandbox</b>: run one episode of any experiment config", 2000)
    r.to(page.locator("#cfg"))
    page.select_option("#cfg", "examples/configs/tools_llm_stack.yaml")
    r.wait(1800)
    r.caption("Here a <b>tool-calling agent</b>: a local model (qwen3.5 on Ollama) operates a Panda through typed tools", 3000)
    r.click(page.get_by_role("button", name="Run episode"), after=800)
    r.caption("It measures with read tools first, then acts; every action is checked and answered with a receipt", 6000)
    notes = ["The event log shows each step; the cameras show what the model sees",
             "Each action runs through the safety shield before it reaches the simulator",
             "The model never sees the task's check: the episode is scored on its own"]
    t_end, i = time.monotonic() + 600, 0
    while time.monotonic() < t_end and page.get_by_role("button", name="Stop").count():
        r.caption(notes[i % len(notes)])
        i += 1
        r.wait(9000)
    r.wait(1500)
    r.caption("Done: the episode is recorded as a run, with its trace", 2400)
    link = page.get_by_role("link", name="Open the replay")
    if link.count():
        r.click(link.first, after=1500)
        page.wait_for_load_state("networkidle")
        r.caption("The replay: every frame, action and event of the episode", 3200)
        r.scroll(400, 1400)
        r.wait(1500)
    r.caption(None, 500)
    return start


# ---------------------------------------------------------------------------------------------- terminal
TERMINAL = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0f1115}
.win{position:absolute;inset:28px 34px;background:#16181d;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.45);
  overflow:hidden;border:1px solid #2a2d35}
.bar{height:34px;background:#1d2027;display:flex;align-items:center;padding:0 14px;gap:8px;color:#8b909a;
  font:500 13px Inter,system-ui,sans-serif}
.dot{width:12px;height:12px;border-radius:50%}
#t{padding:14px 18px;font:13.5px/1.5 "JetBrains Mono",ui-monospace,Menlo,monospace;color:#c9ccd3;white-space:pre-wrap;
  height:calc(100% - 62px);overflow:hidden}
.p{color:#7ee0a8}.h{color:#fff;font-weight:700}.m{color:#9aa0ab;font-style:italic}.c{color:#6c717c}
.r{color:#71c7ff}.a{color:#ff9b6b;font-weight:600}.e{color:#ff6b6b}.ok{color:#7ee0a8;font-weight:700}.s{color:#e8d48a}
.cur{display:inline-block;width:8px;height:15px;background:#c9ccd3;vertical-align:-2px;animation:b 1s steps(1) infinite}
@keyframes b{50%{opacity:0}}
#rec-cursor{display:none!important}
</style></head><body><div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span>
<span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
<span style="margin-left:10px">hylo watch</span></div><div id="t"></div></div>
<script>
const t = document.getElementById('t');
window.addLine = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = text;
  t.appendChild(d); while (t.scrollHeight > t.clientHeight && t.children.length > 1) t.removeChild(t.firstChild); };
window.typeCmd = async (cmd) => { const d = document.createElement('div'); d.innerHTML = '<span class="p">~/hyloai $</span> ';
  t.appendChild(d); const s = document.createElement('span'); d.appendChild(s); const c = document.createElement('span');
  c.className = 'cur'; d.appendChild(c);
  for (const ch of cmd) { s.textContent += ch; await new Promise(r => setTimeout(r, 32)); } c.remove(); };
</script></body></html>"""


def _line_class(line: str) -> str:
    s = line.strip()
    for prefix, cls in (("■ verdict", "ok"), ("■", "h"), ("◆", "m"), ("call ", "c"), ("· ", "r"), ("▶", "a"),
                        ("summary:", "s")):
        if s.startswith(prefix):
            return cls
    return "e" if "bad_arguments" in s or s.startswith("refused") else ""


def terminal(lines_file: Path, command: str, stretch: float = 1.7):
    """A terminal page that replays captured `hylo watch` output at its recorded timing (stretched)."""
    lines = json.loads(Path(lines_file).read_text())
    page_file = Path(lines_file).with_name("terminal.html")
    page_file.write_text(TERMINAL)

    def scene(page, r, _url):
        page.goto(page_file.as_uri())
        r.wait(400)
        start = time.monotonic()
        page.evaluate("(c) => window.typeCmd(c)", command)
        r.wait(len(command) * 32 + 700)
        prev = 0.0
        for t, line in lines:
            if t > prev:
                r.wait(int((t - prev) * stretch * 1000))
            prev = t
            page.evaluate("([c, x]) => window.addLine(c, x)", [_line_class(line), html.escape(line)])
        r.wait(3500)
        return start
    return page_file, scene
