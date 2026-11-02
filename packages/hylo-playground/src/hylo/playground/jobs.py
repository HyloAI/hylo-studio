"""Background jobs: the playground launches the same CLI commands a user would type (hylo run / evolve / learn /
calibrate) as subprocesses, with their output in runs/playground/jobs/<id>.log. Nothing bypasses the CLI's checks."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

KINDS = {
    "run": lambda a: ["run", a["config"], *(["--split", a["split"]] if a.get("split") else []),
                      *[x for kv in a.get("sets", []) for x in ("--set", kv)]],
    "evolve": lambda a: ["evolve", "run", a["config"], *[x for kv in a.get("sets", []) for x in ("--set", kv)]],
    "learn": lambda a: ["learn", a["job"], *(["--python", a["python"]] if a.get("python") else [])],
    "calibrate": lambda a: ["calibrate", "--judge", json.dumps(a["judge"]), "--runs", *a["runs"],
                            "--splits", *a.get("splits", ["search_val"]),
                            *(["--task-prefix", a["task_prefix"]] if a.get("task_prefix") else []),
                            *(["--limit", str(a["limit"])] if a.get("limit") else []),
                            *(["--out", a["out"]] if a.get("out") else [])],
}


def run_cli(args: list[str], *, cwd: str | Path, timeout: float = 300) -> str:
    """Run one `hylo` command synchronously and return its last output line; raise with its output on failure."""
    res = subprocess.run([sys.executable, "-m", "hylo.core.cli", *args], cwd=cwd, capture_output=True, text=True,
                         timeout=timeout)
    if res.returncode != 0:
        raise RuntimeError((res.stderr or res.stdout).strip()[-800:])
    lines = [l for l in res.stdout.splitlines() if l.strip()]
    return lines[-1] if lines else ""


class JobManager:
    def __init__(self, root: str | Path, cwd: str | Path) -> None:
        self.dir = Path(root) / "playground" / "jobs"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.cwd = Path(cwd)
        self._procs: dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def start(self, kind: str, args: dict[str, Any]) -> dict[str, Any]:
        if kind not in KINDS:
            raise ValueError(f"unknown job kind {kind!r}; known: {sorted(KINDS)}")
        jid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
        cmd = [sys.executable, "-m", "hylo.core.cli", *KINDS[kind](args)]
        log = open(self.dir / f"{jid}.log", "w")
        proc = subprocess.Popen(cmd, cwd=self.cwd, stdout=log, stderr=subprocess.STDOUT)
        meta = {"id": jid, "kind": kind, "args": args, "cmd": cmd[3:], "started": time.time(), "pid": proc.pid}
        (self.dir / f"{jid}.json").write_text(json.dumps(meta, indent=2))
        with self._lock:
            self._procs[jid] = proc
        return meta

    def _status(self, jid: str) -> tuple[str, int | None]:
        proc = self._procs.get(jid)
        if proc is None:
            return "finished?", None                 # started by an earlier server process
        rc = proc.poll()
        return ("running", None) if rc is None else ("done" if rc == 0 else "failed", rc)

    def list(self) -> list[dict[str, Any]]:
        out = []
        for f in sorted(self.dir.glob("*.json"), reverse=True)[:100]:
            meta = json.loads(f.read_text())
            status, rc = self._status(meta["id"])
            out.append({**meta, "status": status, "returncode": rc})
        return out

    def log(self, jid: str, tail: int = 200) -> str:
        p = self.dir / f"{jid}.log"
        if not p.exists():
            raise KeyError(jid)
        return "\n".join(p.read_text(errors="replace").splitlines()[-tail:])

    def stop(self, jid: str) -> None:
        proc = self._procs.get(jid)
        if proc is not None and proc.poll() is None:
            proc.terminate()
