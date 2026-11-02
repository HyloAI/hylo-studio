"""Research page backend: sessions and code-agent runs read from their own files, and files served only from inside
a session directory."""

import json
import os
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from hylo.playground.app import _session_root, create_app  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
SOLVE = "import math\n\n\ndef solve(robot):\n    return math.pi\n"


def _jsonl(path: Path, recs: list[dict]) -> None:
    path.write_text("".join(json.dumps(r) + "\n" for r in recs))


def _turn(n: int, **kw) -> dict:
    return {"type": "turn", "t": 1000.0 + 10 * n, "turn": n, "reply": f"step {n}\n```python\nx = {n}\nprint(x)\n```",
            "code": f"x = {n}\nprint(x)", "blocks": 1, "output": f"{n}\n", "error": None, "exec_s": 0.01, "images": [],
            "model": "tiny", "backend": "local", "tokens_in": 100 * n, "tokens_out": 10, "cached_tokens": 50,
            "latency_s": 2.0, "cost_usd": 0.0, "live_case": 0,
            "usage": {"calls": n, "tokens_in": 100 * n, "tokens_out": 10 * n, "cost_usd": 0.0, "latency_s": 2.0 * n}, **kw}


@pytest.fixture
def repo(tmp_path):
    runs = tmp_path / "runs"
    s = runs / "campaign" / "research" / "base-r0"
    (s / "images").mkdir(parents=True)
    (s / "images" / "turn-001-0.png").write_bytes(PNG)
    outcome = {"case": 0, "key": "toy#0", "episode_id": "ep0", "status": "success", "success": True, "steps": 12,
               "reason": "terminated", "output": "done\n", "error": None}
    _jsonl(s / "log.jsonl", [
        {"type": "parent", "t": 999.0, "defined": True, "error": None, "output": ""},
        _turn(1, images=[{"note": "front view", "file": "images/turn-001-0.png"}, {"note": "escape", "file": "../../../secret.png"}],
              prompt={"system": "be brief", "first": "Development cases: [...]"}),
        {"type": "reset", "t": 1015.0, "outcome": {"case": 0, "success": False, "steps": 5, "reason": "agent_done: reset"}, "next_case": 0},
        {"type": "submit", "t": 1018.0, "submission": 1, "successes": 1, "cases": 1, "results": [outcome]},
        _turn(2, code="submit()", reply="```python\nsubmit()\n```"),
        {"type": "end", "t": 1030.0, "stopped": "budget: 2 turns used",
         "frozen": {"artifact": str(s / "frozen" / "toy-sub01"), "digest": "abcdef0123456789", "submission": 1}},
    ])
    sub = s / "submissions" / "sub-01"
    sub.mkdir(parents=True)
    (sub / "solve.py").write_text(SOLVE)
    (sub / "results.json").write_text(json.dumps({"submission": 1, "successes": 1, "results": [outcome]}))
    (sub / "log.jsonl").write_text('{"type": "turn", "turn": 1}\n')            # inside submissions/: not a session
    fz = s / "frozen" / "toy-sub01"
    fz.mkdir(parents=True)
    (fz / "solve.py").write_text(SOLVE)
    (fz / "program.json").write_text(json.dumps({"entry": "solve", "file": "solve.py", "submission": 1, "family": "toy"}))
    (fz / "artifact.json").write_text(json.dumps({"kind": "program", "digest": "abcdef0123456789", "mutable": False,
                                                  "metrics": {"dev_successes": 1, "dev_cases": 1}}))
    (s / "summary.json").write_text(json.dumps({
        "session": "toy-base-r0", "model": "local:tiny", "dev_cases": [{"case": 0, "key": "toy#0", "instruction": "touch the cube"}],
        "budget": {"turns": 2}, "stopped": "budget: 2 turns used", "turns": 2,
        "usage": {"calls": 2, "tokens_in": 300, "tokens_out": 20, "cost_usd": 0.0, "latency_s": 4.0},
        "submissions": [{"submission": 1, "successes": 1, "cases": 1, "outcomes": [{"case": 0, "success": True, "steps": 12}]}],
        "frozen": {"digest": "abcdef0123456789", "submission": 1}, "elapsed_s": 31.0}))
    (s / "notes.sh").write_text("echo not served\n")
    (tmp_path / "secret.png").write_bytes(PNG)
    os.symlink(tmp_path / "secret.png", s / "link.png")                     # points outside the session
    # an interrupted session: turns only, no summary
    i = runs / "research" / "interrupted"
    i.mkdir(parents=True)
    _jsonl(i / "log.jsonl", [_turn(1, prompt={"first": 'Development cases: [{"case": 0, "instruction": "press 8"}]'}), _turn(2)])
    # the campaign that promoted the session's program
    c = runs / "campaign" / "campaign"
    c.mkdir(parents=True)
    (c / "campaign_state.json").write_text(json.dumps({"name": "toy-campaign", "cycles_done": 1, "stopped": "done"}))
    (c / "evolve_config.json").write_text(json.dumps({"proposer": {"type": "research.llm"}}))
    (c / "active.json").write_text(json.dumps({"version": "cand-1"}))
    _jsonl(c / "archive.jsonl", [
        {"candidate": {"id": "cand-1", "kind": "code", "evidence": {"session": str(s)}}, "verdict": "promoted", "stage_reached": 3},
        {"candidate": {"id": "cand-2", "evidence": {"session": str(i)}}, "verdict": "rejected", "stage_reached": 1}])
    # an extra root with a scene-builder run and a motion-studio run
    ex = tmp_path / "agents"
    sc = ex / "scenes" / "ball_cup"
    sc.mkdir(parents=True)
    _jsonl(sc / "turns.jsonl", [{k: v for k, v in _turn(1).items() if k != "type"}])
    (sc / "solve.json").write_text(json.dumps({"instruction": "put the ball in the cup", "model": "local:tiny", "success": True,
                                               "reason": "terminated", "turns": 1, "wall_s": 9.5, "usage": {"tokens_in": 100}}))
    (sc / "front.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
    mo = ex / "motion" / "dance"
    mo.mkdir(parents=True)
    _jsonl(mo / "log.jsonl", [{"event": "start", "request": "a short dance", "robot": "g1", "model": "local:tiny"},
                              {"event": "tool", "tool": "text_motion", "args": {"prompt": "'dance'"}, "result": "Motion(4 s)", "seconds": 1.5},
                              {k: v for k, v in _turn(1, images=[{"note": "pose", "shape": [10, 20, 3]}]).items() if k != "type"},
                              {"event": "end", "stopped": "finished", "turns": 1, "wall_s": 20.0}])
    (mo / "summary.json").write_text(json.dumps({"request": "a short dance", "model": "local:tiny", "stopped": "finished", "turns": 1}))
    return tmp_path


def client(repo, **kw):
    return TestClient(create_app("runs", repo=repo, sessions=["agents=agents"], **kw))


def test_lists_research_sessions_and_code_agent_runs(repo):
    rows = {r["id"]: r for r in client(repo).get("/api/research/sessions").json()}
    assert set(rows) == {"campaign/research/base-r0", "research/interrupted", "agents:scenes/ball_cup", "agents:motion/dance"}
    r = rows["campaign/research/base-r0"]
    assert r["kind"] == "research" and r["model"] == "local:tiny" and r["task"] == "touch the cube"
    assert r["score"] == {"successes": 1, "cases": 1} and r["turns"] == 2 and r["stopped"] == "budget: 2 turns used"
    assert r["usage"]["tokens_in"] == 300 and r["usage"]["cost_usd"] == 0.0 and r["wall_s"] == 31.0 and r["complete"]
    it = rows["research/interrupted"]                       # no summary: everything from the log
    assert not it["complete"] and it["turns"] == 2 and it["model"] == "local:tiny" and it["task"] == "press 8"
    assert it["usage"]["tokens_in"] == 200 and it["wall_s"] == 10.0 and "interrupted" in it["stopped"]
    assert rows["agents:scenes/ball_cup"]["kind"] == "scene" and rows["agents:scenes/ball_cup"]["score"] == {"successes": 1, "cases": 1}
    assert rows["agents:motion/dance"]["kind"] == "motion" and rows["agents:motion/dance"]["task"] == "a short dance"


def test_one_session_timeline_submissions_program_and_campaign(repo):
    s = client(repo).get("/api/research/session", params={"id": "campaign/research/base-r0"}).json()
    assert [e["kind"] for e in s["events"]] == ["parent", "turn", "reset", "submit", "turn", "end"]
    t1 = s["events"][1]
    assert t1["text"] == "step 1" and t1["code"] == "x = 1\nprint(x)" and t1["output"] == "1\n"     # fenced code shown once
    assert t1["images"][0] == {"note": "front view", "file": "images/turn-001-0.png", "shape": None}
    assert t1["images"][1]["file"] is None                   # a reference outside the session is not passed on
    assert t1["prompt"]["system"] == "be brief"
    [sub] = s["submissions"]
    assert sub["frozen"] and sub["source"] == "submissions/sub-01/solve.py"
    assert sub["outcomes"][0]["success"] and sub["outcomes"][0]["output"] == "done\n" and sub["outcomes"][0]["steps"] == 12
    [fz] = s["frozen"]
    assert fz["digest"] == "abcdef0123456789" and fz["source"] == SOLVE and fz["file"] == "frozen/toy-sub01/solve.py"
    assert s["campaigns"] == [{"campaign": "campaign/campaign", "name": "toy-campaign", "candidate": "cand-1",
                               "verdict": "promoted", "stage_reached": 3, "active": True}]
    assert s["dev_cases"][0]["instruction"] == "touch the cube"
    m = client(repo).get("/api/research/session", params={"id": "agents:motion/dance"}).json()
    assert [e["kind"] for e in m["events"]] == ["start", "tool", "turn", "end"]
    assert m["events"][2]["images"] == [{"note": "pose", "file": None, "shape": [10, 20, 3]}]
    sc = client(repo).get("/api/research/session", params={"id": "agents:scenes/ball_cup"}).json()
    assert sc["videos"] == ["front.mp4"] and sc["summary"]["success"] is True


def test_serves_images_sources_and_videos(repo):
    c = client(repo)
    r = c.get("/api/research/file", params={"id": "campaign/research/base-r0", "path": "images/turn-001-0.png"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == PNG
    r = c.get("/api/research/file", params={"id": "campaign/research/base-r0", "path": "frozen/toy-sub01/solve.py"})
    assert r.status_code == 200 and r.text == SOLVE and r.headers["content-type"].startswith("text/plain")
    r = c.get("/api/research/file", params={"id": "agents:scenes/ball_cup", "path": "front.mp4"})
    assert r.status_code == 200 and r.headers["content-type"] == "video/mp4"


@pytest.mark.parametrize("sid", [
    "..", "../runs", "/etc", "campaign/../..", "campaign/research/../../..", "campaign/research/base-r0/../../../..",
    "campaign/research/base-r0/submissions/sub-01",            # trace internals are not sessions
    "agents:..", "agents:../runs/campaign/research/base-r0", "agents:/etc", "nope:scenes/ball_cup", "missing",
    "campaign/campaign",                                       # a directory, but not a session
    "C:/Windows", "campaign\\research\\base-r0", "campaign/research/base-r0\x00",
])
def test_session_ids_cannot_escape_the_roots(repo, sid):
    c = client(repo)
    assert c.get("/api/research/session", params={"id": sid}).status_code == 404
    assert c.get("/api/research/file", params={"id": sid, "path": "log.jsonl"}).status_code == 404


@pytest.mark.parametrize("path", [
    "../../../secret.png", "../interrupted/log.jsonl", "/etc/passwd", "images/../../../../secret.png",
    "link.png",                                                # a symlink that leaves the session
    "notes.sh",                                                # not a servable type
    "images", ".", "", "frozen\\toy-sub01\\solve.py", "~/secret.png", "summary.json\x00.png",
])
def test_files_cannot_escape_the_session(repo, path):
    r = client(repo).get("/api/research/file", params={"id": "campaign/research/base-r0", "path": path})
    assert r.status_code == 404


def test_research_endpoints_need_the_token(repo):
    c = client(repo, token="s3cret")
    assert c.get("/api/research/sessions").status_code == 401
    assert c.get("/api/research/file", params={"id": "campaign/research/base-r0", "path": "images/turn-001-0.png"}).status_code == 401
    assert c.get("/api/research/sessions", params={"token": "s3cret"}).status_code == 200


def test_session_root_specs(tmp_path):
    assert _session_root("ex=agents", tmp_path) == ("ex", (tmp_path / "agents").resolve())
    assert _session_root(str(tmp_path / "agents"), tmp_path) == ("agents", (tmp_path / "agents").resolve())
    with pytest.raises(ValueError):
        _session_root("a:b=agents", tmp_path)
