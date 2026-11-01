"""Live sandbox: run one episode of any experiment config and stream it to the browser as it happens.

The episode runs through the unchanged kernel (EpisodeRunner, SafetyShield). A bus subscriber turns events into
compact messages (camera frames as JPEG every step); the trace keeps every `trace.image_every`-th frame like any run,
in runs/playground/live/<run_id>, under split "playground", which no learner ever reads. Environment and agent are
kept warm between episodes of the same configuration (loading a VLA takes tens of seconds).

User controls: task and seed from the benchmark, config overrides (protected scopes refused), an instruction
override (the agent sees the user's text; the environment's task and success check are unchanged), stop.
"""

from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import numpy as np

from hylo.eval.experiment import build_agent, env_factory
from hylo.core.config import ExperimentConfig, build_manifest
from hylo.core.events import Event, EventBus
from hylo.core.kernel import EpisodeRunner
from hylo.core.registry import registry
from hylo.core.trace import TraceStore
from hylo.core.types import Observation

from hylo.catalog.episodes import to_json as _f

from .render import jpeg

PROTECTED = ("safety", "benchmark", "trace", "scorers", "evolution", "schema_version")
SPLITS = ("validation", "search", "search_val", "gate", "heldout", "train", "test")


class Stopped(RuntimeError):
    pass


class _Override:
    """Agent proxy: instruction override and a stop switch checked before every policy call."""

    def __init__(self, inner: Any, instruction: str | None, stop: threading.Event) -> None:
        self.inner, self.instruction, self.stop = inner, instruction, stop

    def spec(self):
        return self.inner.spec()

    def reset(self, ctx):
        return self.inner.reset(ctx)

    def act(self, observation: Observation):
        if self.stop.is_set():
            raise Stopped("stopped by the user")
        if self.instruction:
            observation = observation.model_copy(update={"instruction": self.instruction})
        return self.inner.act(observation)

    def on_step(self, result):
        return self.inner.on_step(result)

    def on_episode_end(self, outcome):
        return self.inner.on_episode_end(outcome)


def load_config(path: str | Path, overrides: dict[str, Any] | None = None) -> ExperimentConfig:
    cfg = ExperimentConfig.load(path)
    bad = [k for k in (overrides or {}) if k.split(".")[0] in PROTECTED]
    if bad:
        raise ValueError(f"protected settings cannot be changed from the playground: {bad}")
    return cfg.with_overrides(dict(overrides or {})) if overrides else cfg


def task_options(cfg: ExperimentConfig) -> dict[str, Any]:
    bench = registry.build("benchmarks", cfg.benchmark.model_dump(exclude={"split"}))
    splits: dict[str, Any] = {}
    for split in SPLITS:
        try:
            inst = bench.instances(split)
        except Exception:  # noqa: BLE001 - a benchmark simply may not define this split
            continue
        if not inst:
            continue
        tasks: dict[str, dict[str, Any]] = {}
        for i in inst:
            t = tasks.setdefault(i.spec.id, {"task_id": i.spec.id, "instruction": i.spec.instruction, "seeds": [],
                                             "max_steps": i.spec.max_steps})
            t["seeds"].append(i.seed)
        splits[split] = list(tasks.values())
    return {"benchmark": bench.id, "default_split": cfg.benchmark.split, "splits": splits}


def _key(cfg: ExperimentConfig) -> str:
    blob = json.dumps({"env": cfg.env.model_dump(mode="json"), "agent": cfg.agent.model_dump(mode="json")}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


class LiveManager:
    def __init__(self, root: str | Path) -> None:
        self.out_root = Path(root) / "playground" / "live"
        self._warm: tuple[str, Any, Any] | None = None             # (key, env, agent)
        self._lock = threading.Lock()                              # one live episode at a time
        self.stop = threading.Event()
        self.busy = False

    def _components(self, cfg: ExperimentConfig, emit: Callable[[dict[str, Any]], None]):
        k = _key(cfg)
        if self._warm and self._warm[0] == k:
            return self._warm[1], self._warm[2]
        self.close()
        emit({"type": "status", "text": "starting environment and agent (a VLA takes a while to load)"})
        t = time.time()
        env, agent = env_factory(cfg)(), build_agent(cfg)
        agent.spec()
        self._warm = (k, env, agent)
        emit({"type": "status", "text": f"ready in {time.time() - t:.0f}s"})
        return env, agent

    def close(self) -> None:
        if self._warm:
            for c in (self._warm[2], self._warm[1]):
                fn = getattr(c, "close", None)
                if callable(fn):
                    try:
                        fn()
                    except Exception:  # noqa: BLE001
                        pass
            self._warm = None

    def run(self, request: dict[str, Any], emit: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        if not self._lock.acquire(blocking=False):
            raise RuntimeError("another live episode is running")
        self.busy = True
        self.stop.clear()
        try:
            return self._run(request, emit)
        finally:
            self.busy = False
            self._lock.release()

    def _run(self, request: dict[str, Any], emit: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        cfg = load_config(request["config"], request.get("overrides"))
        split = request.get("split") or cfg.benchmark.split
        bench = registry.build("benchmarks", cfg.benchmark.model_dump(exclude={"split"}))
        inst = [i for i in bench.instances(split) if i.spec.id == request["task_id"]]
        if not inst:
            raise ValueError(f"task {request['task_id']} is not in split {split}")
        seed = int(request.get("seed", inst[0].seed))
        task = next((i for i in inst if i.seed == seed), inst[0].model_copy(update={"seed": seed}))
        env, agent = self._components(cfg, emit)
        proxy = _Override(agent, (request.get("instruction") or "").strip() or None, self.stop)
        if proxy.instruction:
            emit({"type": "status", "text": f"the agent will see the instruction: {proxy.instruction!r}"})

        run_id = f"live-{cfg.name}-{cfg.digest()}"
        run_dir = self.out_root / run_id
        store = TraceStore(run_dir)
        keep_every = max(1, cfg.trace.image_every or 1)
        counter = {"obs": 0, "step": 0}

        def on_event(e: Event) -> None:
            p = dict(e.payload)
            if e.type == "observation":
                imgs = p.get("images") or {}
                emit({"type": "observation", "step": counter["step"], "instruction": p.get("instruction"),
                      "images": {c: base64.b64encode(jpeg(v, 75)).decode() for c, v in imgs.items()},
                      "state": _f({k: np.asarray(v).reshape(-1) for k, v in (p.get("state") or {}).items()
                                   if k in ("eef_pos", "gripper_qpos", "pos", "goal")})})
                if counter["obs"] % keep_every:
                    e = e.model_copy(update={"payload": {**p, "images": {}}})
                counter["obs"] += 1
            elif e.type == "action":
                counter["step"] += 1
                emit({"type": "action", "step": counter["step"], "data": _f(np.asarray(p["data"]).reshape(-1))})
            elif e.type == "agent.chunk":
                emit({"type": "chunk", "step": counter["step"], "actions": _f(np.asarray(p["actions"])),
                      "execution_steps": p.get("execution_steps"), "latency_s": _f(p.get("latency_s"), 2),
                      "provenance": _f({k: v for k, v in (p.get("provenance") or {}).items() if k != "seeds"})})
            elif e.type == "safety.review" and p.get("modified"):
                d = np.abs(np.asarray(p["approved"], float) - np.asarray(p["proposed"], float))
                emit({"type": "safety", "step": counter["step"], "reasons": p.get("reasons"),
                      "max_change": round(float(d.max()), 4)})
            elif e.type in ("episode.start", "episode.end", "memory.retrieval", "skill.applied", "error"):
                emit({"type": e.type, "step": counter["step"],
                      "payload": _f({k: v for k, v in p.items() if k not in ("key", "prior")})})
            store.write(e)

        bus = EventBus()
        bus.subscribe(on_event, critical=True)
        runner = EpisodeRunner(env, proxy, bus=bus, safety=cfg.safety, record_privileged=cfg.trace.record_privileged,
                               image_every=1)
        eid = f"{task.spec.id.replace('/', '.')}-s{task.seed}-{uuid.uuid4().hex[:8]}"
        rec = runner.run(task, episode_id=eid)
        store.close()
        self._record(run_dir, cfg, run_id, bench, task, rec, request)
        return {"run_id": run_id, "episode_id": eid, "status": rec.outcome.status, "steps": rec.outcome.steps,
                "safety_interventions": rec.safety_interventions}

    @staticmethod
    def _record(run_dir: Path, cfg: ExperimentConfig, run_id: str, bench: Any, task: Any, rec: Any,
                request: dict[str, Any]) -> None:
        """Keep evallog.json / manifest.json current so the episode shows up in the explorer like any run."""
        man = run_dir / "manifest.json"
        if not man.exists():
            man.write_text(json.dumps(build_manifest(cfg, run_id=run_id, extra={
                "benchmark": {"id": bench.id, "version": bench.version, "digest": bench.digest(), "split": "playground"}}),
                default=str, indent=2))
        logf = run_dir / "evallog.json"
        log = json.loads(logf.read_text()) if logf.exists() else {"version": 1, "run_id": run_id,
                                                                   "benchmark": {"id": bench.id, "split": "playground"},
                                                                   "agent": {"name": cfg.name},
                                                                   "results": {}, "samples": []}
        ok = rec.outcome.status == "success"
        value = None if rec.outcome.status not in ("success", "failure") else float(ok)
        log["samples"].append({"key": task.key, "task_id": task.spec.id, "seed": task.seed,
                               "episode_id": rec.outcome.episode_id, "status": rec.outcome.status,
                               "steps": rec.outcome.steps, "trace": f"episodes/{rec.outcome.episode_id}.jsonl",
                               "scores": {"success": {"value": value}},
                               "playground": {"instruction": request.get("instruction") or None,
                                              "overrides": request.get("overrides") or {}, "split": task.split}})
        vals = [s["scores"]["success"]["value"] for s in log["samples"] if s["scores"]["success"]["value"] is not None]
        log["results"] = {"success_mean": (sum(vals) / len(vals)) if vals else None, "n_episodes": len(log["samples"])}
        logf.write_text(json.dumps(log, indent=2))
