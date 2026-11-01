"""The control plane against workcells. A fake workcell speaking hylo.workcell/v0.1 (core.remote.workcell) keeps
these tests independent of hylo-serve; with serve installed (a development workspace), the episode test
also runs against a real workcell and policy server."""

import socket
import threading
import time

import pytest
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from hylo.core.remote.workcell import OperatorAck, OperatorEvent
from hylo.playground.app import create_app
from hylo.playground.control import Endpoint


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(app) -> tuple[uvicorn.Server, int]:
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.02)
    return server, port


def _fake_workcell() -> FastAPI:
    app, state = FastAPI(), {"state": "idle", "fault": None}

    @app.get("/status")
    def status():
        return {"name": "fake", **state, "tasks": []}

    @app.post("/operator")
    def operator(body: dict):
        try:
            ev = OperatorEvent.model_validate(body)
        except ValidationError as exc:
            raise HTTPException(400, str(exc))
        if ev.type == "estop":
            state.update(state="fault", fault=f"e-stop by {ev.by}")
        elif ev.type == "clear_fault":
            state.update(state="idle", fault=None)
        return OperatorAck(fault=state["fault"], state=state["state"]).model_dump()

    return app


@pytest.fixture
def fake(tmp_path):
    server, port = _serve(_fake_workcell())
    yield {"workcell": Endpoint("double", f"http://127.0.0.1:{port}"), "root": tmp_path}
    server.should_exit = True


@pytest.fixture
def stack(tmp_path):
    pytest.importorskip("hylo.serve", reason="the real workcell is in hylo-serve")
    from hylo.serve.policy import PolicyServer
    from hylo.serve.workcell import WorkcellConfig
    from hylo.serve.workcell import create_app as workcell_app

    policy = PolicyServer(agent={"type": "testing.p_controller", "params": {"kp": 2.0, "horizon": 5, "execution_steps": 5}},
                          port=0, log=lambda m: None).start()
    cfg = WorkcellConfig.model_validate({"name": "double", "env": {"type": "testing.point_reach"}, "output_dir": str(tmp_path / "wc"),
                                         "benchmark": {"type": "testing/reach-v0", "params": {"tags": ["reach"]}},
                                         "runtime": {"latency_s": 0.02, "refill_steps": 1}})
    server, port = _serve(workcell_app(cfg))
    yield {"workcell": Endpoint("double", f"http://127.0.0.1:{port}"), "policy": Endpoint("pctl", f"ws://127.0.0.1:{policy.port}/wc"),
           "root": tmp_path}
    server.should_exit = True
    policy.shutdown()


def test_control_plane_starts_episodes_and_relays_the_live_stream(stack):
    c = TestClient(create_app(stack["root"], repo=stack["root"], workcells=[stack["workcell"]], policies=[stack["policy"]]))
    [w] = c.get("/api/workcells").json()
    assert w["reachable"] and w["status"]["state"] == "idle"
    [p] = c.get("/api/policies").json()
    assert p["reachable"] and p["agent"] == "testing.p_controller"
    task = w["status"]["tasks"][0][0]
    with c.websocket_connect("/api/workcells/double/events") as ws:
        r = c.post("/api/workcells/double/episodes", json={"task_id": task, "seed": 10000, "policy": "pctl"})
        assert r.status_code == 200, r.text
        while (m := ws.receive_json())["type"] not in ("done", "failed"):
            pass
    assert m["type"] == "done" and m["status"] == "success"


def test_roles_gate_actions_but_never_the_estop(fake):
    stack = fake
    tokens = {"viewer": "v", "operator": "o", "approver": "a"}
    c = TestClient(create_app(stack["root"], repo=stack["root"], workcells=[stack["workcell"]], role_tokens=tokens))
    assert c.get("/api/overview").status_code == 401
    v, o = {"x-token": "v"}, {"x-token": "o"}
    assert c.get("/api/me", headers=v).json()["role"] == "viewer"
    assert c.post("/api/jobs", headers=v, json={"kind": "run", "args": {}}).status_code == 403
    assert c.post("/api/workcells/double/operator", headers=v, json={"type": "reset_done"}).status_code == 403
    assert c.post("/api/workcells/double/operator", headers=v, json={"type": "estop"}).json()["fault"].startswith("e-stop by viewer")
    assert c.post("/api/workcells/double/operator", headers=o, json={"type": "clear_fault"}).json()["fault"] is None
    assert c.post("/api/campaign/approve", headers=o, params={"id": "x"}).status_code == 403
    assert c.post("/api/campaign/approve", headers={"x-token": "a"}, params={"id": "x"}).status_code == 404   # allowed, no such campaign
