"""A chat process can build a newer stage while the Studio holds an older world."""
import json

import numpy as np
import pytest

pytest.importorskip("hylo.envs.mujoco.world_tools")
from hylo.envs.mujoco.world import World  # noqa: E402
from hylo.envs.mujoco.world_tools import Workspace  # noqa: E402
from hylo.playground.world import WorldManager  # noqa: E402


def test_view_follows_chat_build_but_not_unbuilt_edits(tmp_path, monkeypatch):
    # The regression concerns which world is rendered, not OpenGL availability.
    monkeypatch.setattr(World, "view", lambda self, **kw: np.full((2, 2, 3), self.stage.revision, dtype=np.uint8))
    manager = WorldManager(tmp_path)
    manager.create("demo")
    assert manager.call("demo", "world_build", {})["ok"]
    external = Workspace(manager.stages, "demo")
    edit = external.surface.call("stage_edit", {"expected_revision": 0, "ops": [{
        "op": "add", "entity": {"id": "cube", "pose": {"pos": [0, 0, 0.1]},
                                 "shape": {"type": "box", "size": [0.1, 0.1, 0.1]}}
    }]})
    assert edit.ok
    before = manager.view("demo")
    assert manager.overview("demo")["world"]["revision"] == 0
    build = external.surface.call("world_build", {})
    assert build.ok
    folder = manager.sessions / "demo" / "episodes"
    folder.mkdir(parents=True)
    event = {"type": "agent.tool.result", "payload": {
        "name": "world_build", "ok": True, "result": build.text()}}
    # A concurrent writer may have started the next event without completing it.
    (folder / "session.jsonl").write_text(json.dumps(event) + '\n{"type":')
    after = manager.view("demo")
    assert before != after
    assert manager.overview("demo")["world"]["revision"] == 1
    generation = manager.overview("demo")["world"]["generation"]
    manager.view("demo")
    assert manager.overview("demo")["world"]["generation"] == generation
    external.world.close()


def test_transcript_waits_for_a_complete_live_event(tmp_path):
    manager = WorldManager(tmp_path)
    folder = manager.sessions / "demo" / "episodes"
    folder.mkdir(parents=True)
    first = json.dumps({"type": "agent.tool.operator", "wall_time": 1, "payload": {"message": "build"}})
    second = json.dumps({"type": "agent.tool.turn", "wall_time": 2, "payload": {"text": "working"}})
    path = folder / "session.jsonl"
    path.write_text(first + "\n" + second[:20])
    data = manager.transcript("demo")
    assert data["lines"] == 1 and len(data["events"]) == 1
    with path.open("a") as f:
        f.write(second[20:] + "\n")
    data = manager.transcript("demo", after=1)
    assert data["lines"] == 2 and data["events"][0]["text"] == "working"
