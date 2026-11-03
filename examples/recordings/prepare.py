"""The stores the recordings show, assembled under a work directory from recorded runs named in a sources file
(see sources.example.json). Sources are only read: campaigns are copied without their runs (the pages read the
state, archive, ledger and cycle reports), skill libraries, lesson books, banks, stages and sessions whole.

One store is made fresh: a MuJoCo reach campaign with manual approval (about 15 s), so a candidate waits for the
approval the campaigns recording performs. Its pending state is kept aside, so every take starts from it."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _common import CAMPAIGN, EXPERIMENT  # noqa: E402

FRESH = "mujoco-reach-gain"


def hylo(args: list[str], cwd: Path, log: Path) -> None:
    with open(log, "a") as f:
        subprocess.run([sys.executable, "-m", "hylo.core.cli", *args], cwd=cwd, stdout=f, stderr=subprocess.STDOUT,
                       check=True)


def light_copy(src: Path, dst: Path) -> None:
    """A campaign directory without its runs."""
    dst.mkdir(parents=True, exist_ok=True)
    for f in src.iterdir():
        if f.is_file() and f.suffix in (".json", ".jsonl", ".yaml"):
            shutil.copy2(f, dst / f.name)
        elif f.name == "registry":
            shutil.copytree(f, dst / f.name, dirs_exist_ok=True)
        elif f.is_dir() and f.name.startswith("cycle-"):
            (dst / f.name).mkdir(exist_ok=True)
            for g in f.glob("*.json"):
                shutil.copy2(g, dst / f.name / g.name)


def copy_dir(src: str, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def campaigns(work: Path, src: dict[str, Any]) -> Path:
    store = work / "campaigns"
    if store.exists():
        shutil.rmtree(store)
    (store / "examples" / "configs").mkdir(parents=True)
    (store / "examples" / "evolve").mkdir(parents=True)
    (store / "examples" / "configs" / "mujoco_reach.yaml").write_text(yaml.safe_dump(EXPERIMENT, sort_keys=False))
    camp = {**CAMPAIGN, "approval": "manual"}
    (store / "examples" / "evolve" / "mujoco_reach_gain.yaml").write_text(yaml.safe_dump(camp, sort_keys=False))
    t = time.monotonic()
    hylo(["evolve", "run", "examples/evolve/mujoco_reach_gain.yaml"], store, work / "prepare.log")
    pending = store / "runs" / "evolve" / FRESH
    if not (pending / "pending_approval.json").exists():
        raise RuntimeError(f"the fresh campaign has no candidate awaiting approval; see {work / 'prepare.log'}")
    copy_dir(str(pending), work / "pending-backup")
    for c in src.get("campaigns", []):
        light_copy(Path(c["src"]), store / "runs" / "evolve" / c["name"])
    print(f"campaigns store ready in {time.monotonic() - t:.0f} s")
    return store


def reset_pending(work: Path) -> None:
    copy_dir(str(work / "pending-backup"), work / "campaigns" / "runs" / "evolve" / FRESH)


def experience(work: Path, src: dict[str, Any]) -> Path:
    store = work / "experience"
    if store.exists():
        shutil.rmtree(store)
    runs = store / "runs"
    for kind, folder in (("skills", "skills"), ("lessons", "lessons"), ("banks", "memory")):
        for item in src.get(kind, []):
            copy_dir(item["src"], runs / folder / item["name"])
    for c in src.get("campaigns", []):
        light_copy(Path(c["src"]), runs / "evolve" / c["name"])
    return store


def world(work: Path, src: dict[str, Any]) -> Path:
    store = work / "world"
    if store.exists():
        shutil.rmtree(store)
    for s in src.get("stages", []):
        copy_dir(s["src"], store / "runs" / "world" / "stages" / s["name"])
    for s in src.get("sessions", []):
        copy_dir(s["src"], store / "runs" / "world" / "sessions" / s["stage"])
    if src.get("live_config"):
        cfg = yaml.safe_load(Path(src["live_config"]).read_text())
        cfg["name"] = "tools-llm-stack"
        (store / "examples" / "configs").mkdir(parents=True)
        (store / "examples" / "configs" / "tools_llm_stack.yaml").write_text(yaml.safe_dump(cfg, sort_keys=False))
    return store


def watch_lines(work: Path, run: str, speed: float = 8.0) -> Path:
    """`hylo watch RUN --replay` with the time of every printed line."""
    out = work / "watch_lines.json"
    proc = subprocess.Popen([sys.executable, "-m", "hylo.core.cli", "watch", run, "--replay", "--speed", str(speed)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    t0, lines = time.monotonic(), []
    for line in proc.stdout:
        lines.append([round(time.monotonic() - t0, 2), line.rstrip("\n")])
    proc.wait()
    out.write_text(json.dumps(lines))
    return out
