import json

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from hylo.eval.experiment import run_experiment  # noqa: E402
from hylo.core.config import ExperimentConfig  # noqa: E402
from hylo.playground.app import create_app  # noqa: E402

CFG = """schema_version: hylo.experiment/v0.1
name: double-play
benchmark: {type: testing/reach-v0, split: validation, params: {tags: [reach]}}
env: {type: testing.point_reach}
agent: {type: testing.p_controller, params: {kp: 0.5}}
safety: {max_delta: 0.25}
"""


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "examples" / "configs").mkdir(parents=True)
    (tmp_path / "examples" / "evolve").mkdir(parents=True)
    (tmp_path / "examples" / "configs" / "double.yaml").write_text(CFG)
    cfg = ExperimentConfig.load(tmp_path / "examples" / "configs" / "double.yaml")
    for kp in (0.5, 2.0):
        run_experiment(cfg.with_overrides({"agent.params.kp": kp}), run_root=tmp_path / "runs" / "ab", label=f"kp{kp}")
    return tmp_path


def test_read_only_pages(repo):
    c = TestClient(create_app("runs", repo=repo))
    o = c.get("/api/overview").json()
    assert o["runs"] == 2 and o["episodes"] > 0
    a, b = sorted(c.get("/api/runs").json(), key=lambda r: r["run_id"])
    run = c.get(f"/api/runs/{a['run_id']}").json()
    ep = run["samples"][0]["episode_id"]
    tl = c.get(f"/api/runs/{a['run_id']}/episodes/{ep}").json()
    assert tl["steps"] == len(tl["actions"]) > 0 and tl["chunks"] and tl["start"]["task_id"]
    cmp = c.get("/api/compare", params={"a": a["run_id"], "b": b["run_id"]}).json()
    assert cmp["paired"]["n_pairs"] == run["summary"]["n"] and cmp["per_task"]
    assert c.get("/api/runs/nope").status_code == 404
    assert c.get("/api/configs").json()["experiments"] == ["examples/configs/double.yaml"]


def test_live_episode_streams_and_is_saved_under_the_playground_split(repo):
    c = TestClient(create_app("runs", repo=repo))
    opts = c.post("/api/live/options", json={"config": "examples/configs/double.yaml"}).json()
    task = opts["splits"]["validation"][0]
    with c.websocket_connect("/api/live") as ws:
        ws.send_json({"config": "examples/configs/double.yaml", "split": "validation", "task_id": task["task_id"],
                      "seed": task["seeds"][0], "instruction": "hurry", "overrides": {"agent.params.kp": 2.0}})
        kinds = []
        while True:
            m = ws.receive_json()
            kinds.append(m["type"])
            if m["type"] in ("done", "failed"):
                break
    assert m["type"] == "done" and m["status"] == "success"
    assert {"episode.start", "observation", "chunk", "action", "episode.end"} <= set(kinds)
    live = [r for r in c.get("/api/runs").json() if r["split"] == "playground"]
    assert len(live) == 1 and live[0]["n"] == 1
    log = json.loads((repo / "runs" / live[0]["path"] / "evallog.json").read_text())
    assert log["samples"][0]["playground"]["instruction"] == "hurry"


def test_protected_settings_cannot_be_overridden(repo):
    c = TestClient(create_app("runs", repo=repo))
    r = c.post("/api/live/options", json={"config": "examples/configs/double.yaml", "overrides": {"safety.max_delta": 9}})
    assert r.status_code == 400 and "protected" in r.json()["detail"]


def test_token_is_required_when_configured(repo):
    c = TestClient(create_app("runs", repo=repo, token="s3cret"))
    assert c.get("/api/overview").status_code == 401
    assert c.get("/api/overview", headers={"x-token": "s3cret"}).status_code == 200


def test_approval_and_rollback_go_through_the_wc_command(repo, monkeypatch):
    from hylo.evolve.campaign import EvolveConfig, run_campaign

    monkeypatch.chdir(repo)
    cfg = EvolveConfig(name="pg", experiment="examples/configs/double.yaml", approval="manual", cycles=1,
                       experiment_overrides={"benchmark.params": {"tags": ["reach"], "protocol": "rsi"}},
                       proposer={"type": "rule.gain", "params": {"path": "agent.params.kp", "factors": [4.0]}},
                       out_dir="runs/evolve/pg")
    run_campaign(cfg, log=lambda m: None)
    c = TestClient(create_app("runs", repo=repo))
    detail = c.get("/api/campaign", params={"id": "evolve/pg"}).json()
    assert detail["pending"] is not None
    promoted = c.post("/api/campaign/approve", params={"id": "evolve/pg"}).json()["promoted"]
    assert promoted == detail["pending"]["candidate_id"]
    assert c.post("/api/campaign/approve", params={"id": "evolve/pg"}).status_code == 409
    assert c.post("/api/campaign/rollback", params={"id": "evolve/pg"}, json={}).status_code == 400
    assert c.post("/api/campaign/rollback", params={"id": "evolve/pg"}, json={"reason": "test"}).json()["active"] is None
    assert c.get("/api/campaign", params={"id": "evolve/pg"}).json()["active"] is None
