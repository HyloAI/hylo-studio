"""Shared helpers for the studio examples: build a self-contained demo store and start the playground on it,
with a policy server and a simulated-arm workcell behind the Operator page.

Not an example itself (the leading underscore). Everything goes through the `hylo` command and HTTP APIs.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Sequence

import yaml

ROOT = Path(__file__).resolve().parents[1]            # the studio repository
STATIC = ROOT / "packages" / "hylo-playground" / "src" / "hylo" / "playground" / "static"

EXPERIMENT = {"schema_version": "hylo.experiment/v0.1", "name": "mujoco-reach",
              "benchmark": {"type": "mujoco/reach-v0", "split": "validation"}, "env": {"type": "mujoco.planar_reach"},
              "agent": {"type": "baseline.planar_ik", "params": {"kp": 0.3}}, "output_dir": "runs"}
CAMPAIGN = {"schema_version": "hylo.evolve/v0.1", "name": "mujoco-reach-gain", "experiment": "../configs/mujoco_reach.yaml",
            "experiment_overrides": {"agent.params.kp": 0.02, "workers": 16, "benchmark.params": {"protocol": "rsi", "gate_looks": 2}},
            "proposer": {"type": "rule.gain", "params": {"path": "agent.params.kp", "factors": [2.0, 4.0]}},
            "protocol": {"alpha": 0.05, "gate_looks": 2, "stage1_pairs": 20}, "cycles": 3, "stop_after_no_progress": 1,
            "approval": "auto", "out_dir": "runs/evolve/mujoco-reach-gain"}
# The simulated-arm workcell of the deployments template (workcells/sim_arm.yaml), inlined so the demo needs no
# other checkout; the policy URL and output directory are filled in.
SIM_ARM = {"name": "sim-arm", "env": {"type": "lerobot.robot", "params": {
    "robot": {"type": "sim_arm", "params": {"image_size": 128, "max_relative_target": 10}}, "cameras": {"front": "agentview"},
    "action_low": [-120, -120, -120, -120, -170, 0], "action_high": [120, 120, 120, 120, 170, 100],
    "home": [0, -30, 60, 0, 0, 20], "control_hz": 30}},
    "runtime": {"clock": "wall", "refill_steps": 5, "max_hold_steps": 60, "require_reset_confirm": True, "verdict_timeout_s": 120},
    "safety": {"max_delta": 12.0}, "image_every": 5, "max_steps": 300}
WAVE = {"type": "bringup.wave", "params": {"amplitude": 8, "horizon": 15}}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def http(method: str, url: str, body: dict[str, Any] | None = None, timeout: float = 30.0) -> tuple[int, Any]:
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw or b"null")
            except ValueError:
                return r.status, raw.decode(errors="replace")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read())
        except ValueError:
            return exc.code, None


def hylo(*args: str, cwd: Path, timeout: float = 600) -> str:
    res = subprocess.run([sys.executable, "-m", "hylo.core.cli", *args], cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if res.returncode != 0:
        raise RuntimeError(f"hylo {' '.join(args)} failed:\n{(res.stderr or res.stdout)[-1500:]}")
    return res.stdout


class Procs:
    """Subprocesses started by an example; `stop_all` (in a finally) terminates every one of them."""

    def __init__(self, logdir: Path) -> None:
        self.logdir, self.procs = logdir, {}
        logdir.mkdir(parents=True, exist_ok=True)

    def start(self, name: str, args: Sequence[str], cwd: Path | None = None) -> subprocess.Popen:
        log = open(self.logdir / f"{name}.log", "w")
        p = subprocess.Popen([sys.executable, "-m", "hylo.core.cli", *args], stdout=log, stderr=subprocess.STDOUT, cwd=cwd,
                             start_new_session=True)
        self.procs[name] = p
        return p

    def wait_http(self, name: str, url: str, timeout: float = 60.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(url, timeout=2):
                    return
            except (urllib.error.URLError, ConnectionError, OSError):
                if self.procs[name].poll() is not None:
                    raise RuntimeError(f"{name} exited:\n{(self.logdir / f'{name}.log').read_text()[-2000:]}")
                time.sleep(0.1)
        raise TimeoutError(f"{url} did not come up in {timeout:.0f}s")

    def stop_all(self) -> None:
        for name, p in list(self.procs.items()):
            if p.poll() is None:
                os.killpg(p.pid, signal.SIGTERM)
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(p.pid, signal.SIGKILL)
            self.procs.pop(name)


def start_robot_side(procs: Procs, store: Path) -> tuple[str, str]:
    """A policy server (the bring-up wave) and the simulated-arm workcell recording into the store."""
    pport, wport = free_port(), free_port()
    procs.start("policy", ["serve", "policy", "--agent", json.dumps(WAVE), "--port", str(pport)])
    procs.wait_http("policy", f"http://127.0.0.1:{pport}/healthz")
    cfg = {**SIM_ARM, "policy": {"url": f"ws://127.0.0.1:{pport}/hylo", "protocol": "hylo"},
           "output_dir": str(store / "runs" / "workcell")}
    (store / "workcell.yaml").write_text(yaml.safe_dump(cfg, sort_keys=False))
    procs.start("workcell", ["serve", "workcell", "--config", str(store / "workcell.yaml"), "--port", str(wport)])
    procs.wait_http("workcell", f"http://127.0.0.1:{wport}/healthz")
    return f"ws://127.0.0.1:{pport}/hylo", f"http://127.0.0.1:{wport}"


def operated_episode(base: str, instruction: str, max_steps: int, verdict: str = "success", timeout: float = 120) -> dict[str, Any]:
    """One workcell episode with this script as the operator: confirm the reset, give the verdict."""
    before = (http("GET", base + "/status")[1].get("last") or {}).get("episode_id")
    code, body = http("POST", base + "/episodes", {"instruction": instruction, "max_steps": max_steps})
    if code != 200:
        raise RuntimeError(f"POST /episodes -> {code}: {body}")
    deadline, sent = time.monotonic() + timeout, set()
    while time.monotonic() < deadline:
        st = http("GET", base + "/status")[1]
        if st["state"] == "awaiting_reset" and "reset" not in sent:
            http("POST", base + "/operator", {"type": "reset_done", "by": "demo"})
            sent.add("reset")
        elif st["state"] == "awaiting_verdict" and "verdict" not in sent:
            http("POST", base + "/operator", {"type": "verdict", "verdict": verdict, "by": "demo"})
            sent.add("verdict")
        elif st["state"] in ("idle", "fault") and (st.get("last") or {}).get("episode_id", before) != before:
            return st["last"]
        time.sleep(0.02)
    raise TimeoutError(f"workcell episode did not finish: {st}")


def build_store(store: Path, procs: Procs, *, quick: bool, log: Callable[[str], None] = print) -> dict[str, Any]:
    """Runs, two scorecards, a campaign, a sealed artifact and workcell episodes, each by the command a user types.
    Returns the time of each step and the robot-side endpoints (left running for the Operator page)."""
    t_all, steps = time.monotonic(), {}

    def step(name: str, fn: Callable[[], Any]) -> Any:
        t = time.monotonic()
        out = fn()
        steps[name] = round(time.monotonic() - t, 2)
        log(f"  {name:<34} {steps[name]:6.1f} s")
        return out

    (store / "examples" / "configs").mkdir(parents=True, exist_ok=True)
    (store / "examples" / "evolve").mkdir(parents=True, exist_ok=True)
    (store / "examples" / "configs" / "mujoco_reach.yaml").write_text(yaml.safe_dump(EXPERIMENT, sort_keys=False))
    (store / "examples" / "evolve" / "mujoco_reach_gain.yaml").write_text(yaml.safe_dump(CAMPAIGN, sort_keys=False))
    policies = {"ik-kp0.30": 0.3, "ik-kp0.02": 0.02}
    for name, kp in policies.items():
        step(f"hylo bench run mujoco-reach ({name})", lambda kp=kp, name=name: hylo(
            "bench", "run", "mujoco-reach", "--policy", json.dumps({"type": "baseline.planar_ik", "params": {"kp": kp}}),
            "--name", name, "--out", "runs/bench", "--workers", "16", cwd=store))
    cmp = step("hylo bench compare", lambda: hylo("bench", "compare", "runs/bench/scorecards/mujoco-reach/ik-kp0.30.json",
                                                  "runs/bench/scorecards/mujoco-reach/ik-kp0.02.json", cwd=store))
    step("hylo evolve run (gain campaign)", lambda: hylo("evolve", "run", "examples/evolve/mujoco_reach_gain.yaml", cwd=store))
    (store / "knn_job.json").write_text(json.dumps({"learner": "policy.knn", "inputs": ["runs/evolve/mujoco-reach-gain"],
                                                    "out": "runs/artifacts/reach-knn", "params": {}}))
    step("hylo learn (policy.knn artifact)", lambda: hylo("learn", "knn_job.json", cwd=store))
    policy_url, workcell_url = step("start policy server + workcell", lambda: start_robot_side(procs, store))
    n, max_steps = (1, 90) if quick else (2, 150)
    verdicts = ["success", "partial"]
    eps = step(f"workcell episodes ({n} x {max_steps} steps)", lambda: [
        operated_episode(workcell_url, "wave the shoulder", max_steps, verdicts[k % 2]) for k in range(n)])
    return {"steps_s": steps, "build_s": round(time.monotonic() - t_all, 2), "policy_url": policy_url,
            "workcell_url": workcell_url, "bench_compare": cmp.strip()[-600:], "workcell_episodes": eps}


def start_playground(procs: Procs, store: Path, policy_url: str | None, workcell_url: str | None, port: int | None = None,
                     name: str = "playground", extra: Sequence[str] = ()) -> str:
    if not (STATIC / "index.html").exists():
        raise RuntimeError("the web bundle is not built: cd studio/web && npm install --ignore-scripts && npm run build")
    port = port or free_port()
    args = ["playground", "--repo", str(store), "--port", str(port)]
    if workcell_url:
        args += ["--workcell", f"sim-arm={workcell_url}"]
    if policy_url:
        args += ["--policy", f"wave={policy_url}"]
    procs.start(name, [*args, *extra])
    url = f"http://127.0.0.1:{port}"
    procs.wait_http(name, url + "/api/me")
    return url


def wait_job(url: str, jid: str, timeout: float = 120) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = next(j for j in http("GET", url + "/api/jobs")[1] if j["id"] == jid)
        if job["status"] != "running":
            return job
        time.sleep(0.2)
    raise TimeoutError(f"job {jid} still running")
