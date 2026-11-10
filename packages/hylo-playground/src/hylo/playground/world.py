"""The Studio's world page backend (RFC-0008 part 11): stages, direct tool calls on a stage world, a free view, and
chat sessions with a model (`hylo world chat` as a subprocess, follow-up messages through its inbox).

The world surface is resolved through the registry (`hylo.surfaces`, `mujoco.world`), so the playground imports no
simulator code. MuJoCo objects are not thread-safe: every stage has its own lock and its own world.
"""

from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from hylo.core.registry import registry
from hylo.core.stage import Stage, StageStore


def _png(image: Any) -> bytes:
    import numpy as np
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(np.asarray(image, np.uint8)).save(buf, format="PNG")
    return buf.getvalue()


def _data_url(image: Any) -> str:
    return "data:image/png;base64," + base64.b64encode(_png(image)).decode()


class WorldManager:
    def __init__(self, root: Path, surface: str = "mujoco.world") -> None:
        self.root = Path(root)
        self.stages = self.root / "world" / "stages"
        self.sessions = self.root / "world" / "sessions"
        self.store = StageStore(self.stages)
        self.surface_name = surface
        self._surfaces: dict[str, Any] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._procs: dict[str, subprocess.Popen] = {}
        self._guard = threading.Lock()

    # ------------------------------------------------------------------ stages and surfaces
    def list(self) -> list[dict[str, Any]]:
        out = []
        for name in self.store.names():
            st = self.store.load(name)
            out.append({"name": name, "revision": st.revision, "entities": len(st.entities),
                        "chat": self._running(name)})
        return out

    def create(self, name: str) -> dict[str, Any]:
        st = self.store.create(Stage(name=name), note="created in the Studio")
        return {"name": st.name, "revision": st.revision}

    def _lock(self, stage: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(stage, threading.Lock())

    def surface(self, stage: str) -> Any:
        if stage not in self._surfaces:
            if not self.store.exists(stage):
                raise KeyError(f"no stage {stage!r}")
            self._surfaces[stage] = registry.build("surfaces", {"type": self.surface_name, "params": {
                "root": str(self.stages), "stage": stage, "out": str(self.root / "world" / "outputs" / stage)}})
        return self._surfaces[stage]

    def call(self, stage: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        with self._lock(stage):
            r = self.surface(stage).call(tool, arguments)
        return {"ok": r.ok, "result": r.result, "error": r.error, "images": [_data_url(i) for i in r.images],
                "image_notes": r.image_notes}

    def overview(self, stage: str) -> dict[str, Any]:
        with self._lock(stage):
            s = self.surface(stage)
            show = s.call("stage_show", {}).result
            ws = s.call("world_state", {})
        return {"stage": show, "world": ws.result if ws.ok else None, "chat": self._running(stage)}

    def view(self, stage: str, **cam: Any) -> bytes:
        with self._lock(stage):
            s = self.surface(stage)
            state = s.call("world_state", {})
            # Chat runs in another process. Recompile this viewer only once the
            # model has built the latest revision; unbuilt edits stay staged.
            stale_chat = (state.ok and state.result.get("revision") != state.result.get("stage_revision_now")
                          and self._chat_built_revision(stage) == state.result.get("stage_revision_now"))
            if not state.ok or stale_chat:
                b = s.call("world_build", {})
                if not b.ok:
                    raise ValueError(b.error.get("message") if b.error else "the world does not build")
            r = s.call("view", {k: v for k, v in cam.items() if v is not None})
        if not r.ok:
            raise ValueError(r.error.get("message"))
        return _png(r.images[0])

    def _chat_built_revision(self, stage: str) -> int | None:
        folder = self.sessions / stage / "episodes"
        for path in sorted(folder.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
            for line in reversed(path.read_text(encoding="utf-8").splitlines()):
                try:
                    event = json.loads(line)
                    payload = event.get("payload") or {}
                    if (event.get("type") == "agent.tool.result" and payload.get("name") == "world_build"
                            and payload.get("ok")):
                        return json.loads(payload["result"]).get("revision")
                except (ValueError, KeyError, TypeError):
                    continue  # a running session may still be writing its last line
        return None

    # ------------------------------------------------------------------ chat sessions
    def _running(self, stage: str) -> bool:
        p = self._procs.get(stage)
        return bool(p and p.poll() is None)

    def chat(self, stage: str, message: str, model: str = "ollama:qwen3.5:35b-a3b", vision: bool = True,
             text_tools: bool = False) -> dict[str, Any]:
        out = self.sessions / stage
        inbox = out / "inbox.jsonl"
        if self._running(stage):
            out.mkdir(parents=True, exist_ok=True)
            with open(inbox, "a") as f:
                f.write(json.dumps({"message": message, "from": "studio"}) + "\n")
            return {"session": str(out), "sent": "to the running session"}
        out.mkdir(parents=True, exist_ok=True)
        cmd = [sys.executable, "-m", "hylo.core.cli", "world", "chat", message, "--stage", stage, "--root",
               str(self.stages), "--out", str(out), "--model", model, "--inbox", str(inbox)]
        if vision:
            cmd.append("--vision")
        if text_tools:
            cmd.append("--text-tools")
        log = open(out / "session.log", "a")
        self._procs[stage] = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ))
        self._surfaces.pop(stage, None)            # the session changes the stage: rebuild ours on next use
        return {"session": str(out), "sent": "a new session"}

    def stop(self, stage: str) -> dict[str, Any]:
        p = self._procs.get(stage)
        if p and p.poll() is None:
            p.terminate()
        return {"stopped": True}

    def transcript(self, stage: str, after: int = 0) -> dict[str, Any]:
        """Agent events of the stage's sessions (newest last), from line `after` on; images as data URLs."""
        folder = self.sessions / stage / "episodes"
        rows: list[dict[str, Any]] = []
        files = sorted(folder.glob("*.jsonl"), key=lambda p: p.stat().st_mtime) if folder.is_dir() else []
        n = 0
        for f in files:
            with open(f, encoding="utf-8") as fh:
                for line in fh:
                    if not line.endswith("\n"):
                        break  # do not advance past a live writer's incomplete event
                    n += 1
                    if n <= after or '"agent.tool.' not in line[:40]:
                        continue
                    ev = json.loads(line)
                    p = ev.get("payload") or {}
                    row: dict[str, Any] = {"n": n, "type": ev["type"].removeprefix("agent.tool."), "time": ev["wall_time"]}
                    for k in ("call", "calls", "text", "name", "kind", "arguments", "ok", "result", "message", "answer",
                              "tokens_in", "tokens_out", "latency_s", "model", "tools"):
                        if k in p:
                            row[k] = p[k]
                    if "result" in row and isinstance(row["result"], str):
                        row["result"] = row["result"][:1500]
                    img = p.get("image")
                    if isinstance(img, dict) and "__blob__" in img:
                        import numpy as np

                        arr = np.load(f.parent.parent / "blobs" / img["__blob__"], allow_pickle=False)
                        row["image"] = _data_url(arr)
                    elif isinstance(img, dict) and "__nd__" in img:
                        from hylo.core import codec

                        row["image"] = _data_url(codec.decode_array(img))
                    rows.append(row)
        return {"events": rows, "lines": n, "running": self._running(stage)}


__all__ = ["WorldManager"]
