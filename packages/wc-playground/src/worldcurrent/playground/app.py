"""worldcurrent playground: a local web UI over the existing system (FastAPI backend + React frontend).

    wc-playground --root runs --port 8765            # then open http://127.0.0.1:8765

Read-only pages go through the catalog API (worldcurrent.catalog), never through other packages' internals.
Actions go through public paths only: live episodes through the kernel and SafetyShield, components through the
plugin registry, jobs and approval / rollback through the `wc` command. Protected settings (safety, benchmark, trace, scoring)
cannot be overridden from the UI. Binds to 127.0.0.1 by default; with --token every API call needs it.

It is also the control plane for workcells and policy servers (control.py): `--workcell name=url`,
`--policy name=url`, and per-role tokens (`--role-token viewer=... operator=... approver=...`).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import ValidationError

from worldcurrent.catalog.episodes import TraceCache, frame_array, timeline
from worldcurrent.catalog.index import Catalog
from worldcurrent.core.registry import registry
from worldcurrent.core.store import Store, StoreError, is_ref

from .control import ControlPlane, Endpoint, Roles
from .jobs import JobManager, run_cli
from .render import jpeg
from .live import LiveManager, load_config, task_options

STATIC = Path(__file__).parent / "static"
DEFAULT_JUDGE = "artifact:l10-trace-v2@54a1efadf00d34d8"      # LIBERO-10 trace judge, calibrated (RFC-0004)


APPROVER_PATHS = ("/api/campaign/approve", "/api/campaign/rollback")


def create_app(root: str | Path = "runs", *, repo: str | Path = ".", token: str | None = None,
               judge: str | None = None, workcells: list[Endpoint] | None = None, policies: list[Endpoint] | None = None,
               role_tokens: dict[str, str] | None = None) -> FastAPI:
    repo = Path(repo).resolve()
    root = (repo / root).resolve() if not Path(root).is_absolute() else Path(root)
    app = FastAPI(title="worldcurrent playground", docs_url="/api/docs", openapi_url="/api/openapi.json")
    index, traces = Catalog(root), TraceCache()
    live, jobs = LiveManager(root), JobManager(root, repo)
    def artifact_path(ref: str) -> str | None:
        try:
            return str(Store(root).path(ref))
        except StoreError:
            return None

    default_judge = (artifact_path(judge) if judge and is_ref(judge) else judge) or artifact_path(DEFAULT_JUDGE)
    judges: dict[str, Any] = {}

    roles = Roles(role_tokens, token)
    control = ControlPlane(workcells or [], policies or [])

    @app.middleware("http")
    async def auth(request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api") or path in ("/api/docs", "/api/openapi.json"):
            return await call_next(request)
        role = roles.role(request.headers.get("x-token", request.query_params.get("token")))
        if role is None:
            return JSONResponse({"detail": "missing or wrong token"}, status_code=401)
        if request.method != "GET":
            needed = "approver" if path in APPROVER_PATHS else "viewer" if path.endswith("/operator") else "operator"
            if not roles.allows(role, needed):                 # workcell operator events are checked per event type
                return JSONResponse({"detail": f"this action needs the {needed} role (you are {role})"}, status_code=403)
        request.state.role = role
        return await call_next(request)

    def nf(exc: Exception):
        return HTTPException(404, str(exc))

    # ------------------------------------------------------------ overview and runs
    @app.get("/api/overview")
    def overview() -> dict[str, Any]:
        runs = index.runs()
        arts = index.artifacts()
        judge_art = next((a for a in arts if default_judge and Path(default_judge).resolve() == (root / a["path"]).resolve()), None)
        bench = next((r for r in runs if r["split"] not in ("playground", "deployment") and r["benchmark"]
                      and r["benchmark"].startswith("libero")), None)
        return {"root": str(root), "runs": len(runs), "episodes": sum(r["n"] for r in runs),
                "campaigns": index.campaigns(), "artifacts": len(arts), "recent": runs[:8],
                "judge": judge_art, "live_busy": live.busy, "loop": index.loop_summary(),
                "latest_live": index.latest_live(),
                "context": {"benchmark": bench["benchmark"], "agent": bench["agent"]} if bench else None}

    @app.get("/api/runs")
    def runs() -> list[dict[str, Any]]:
        return index.runs()

    @app.get("/api/runs/{run_id}")
    def run(run_id: str) -> dict[str, Any]:
        try:
            return index.run(run_id)
        except KeyError as exc:
            raise nf(exc)

    @app.get("/api/runs/{run_id}/episodes/{episode_id}")
    def episode(run_id: str, episode_id: str) -> dict[str, Any]:
        try:
            return timeline(traces.get(index.run_dir(run_id), episode_id))
        except KeyError as exc:
            raise nf(exc)

    @app.get("/api/runs/{run_id}/episodes/{episode_id}/frame")
    def episode_frame(run_id: str, episode_id: str, obs: int = Query(...), cam: str = Query("agentview")) -> Response:
        try:
            data = jpeg(frame_array(traces.get(index.run_dir(run_id), episode_id), obs, cam))
        except KeyError as exc:
            raise nf(exc)
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})

    @app.get("/api/runs/{run_id}/episodes/{episode_id}/judge")
    def episode_judge(run_id: str, episode_id: str, path: str | None = None) -> dict[str, Any]:
        p = (artifact_path(path) if path and is_ref(path) else path) or default_judge
        if not p:
            raise HTTPException(404, "no judge artifact configured")
        if p not in judges:
            judges[p] = registry.build("instruments", {"type": "judge.trace", "params": {"path": p}})
        try:
            tr = traces.get(index.run_dir(run_id), episode_id)
        except KeyError as exc:
            raise nf(exc)
        try:
            j = judges[p].judge(tr)
        except (KeyError, ValueError) as exc:          # e.g. an env without the judge's cameras / state keys
            raise HTTPException(404, f"the judge does not apply to this episode: {exc}")
        return {"judge": judges[p].name, "path": index.rel(Path(p)), **j.model_dump(mode="json")}

    @app.get("/api/compare")
    def compare(a: str, b: str) -> dict[str, Any]:
        try:
            return index.compare(a, b)
        except KeyError as exc:
            raise nf(exc)

    # ------------------------------------------------------------ campaigns
    @app.get("/api/campaigns")
    def campaigns() -> list[dict[str, Any]]:
        return index.campaigns()

    @app.get("/api/campaign")
    def campaign(id: str) -> dict[str, Any]:
        try:
            return index.campaign(id)
        except KeyError as exc:
            raise nf(exc)

    def _campaign_dir(cid: str) -> Path:
        d = (root / cid).resolve()
        if root not in d.parents or not (d / "evolve_config.json").exists():
            raise HTTPException(404, cid)
        return d

    @app.post("/api/campaign/approve")
    def campaign_approve(id: str) -> dict[str, Any]:
        d = _campaign_dir(id)
        if not (d / "pending_approval.json").exists():
            raise HTTPException(409, "nothing is waiting for approval")
        out = run_cli(["evolve", "approve", str(d)], cwd=repo)            # the same command a person would run
        return {"promoted": out.rsplit(" ", 1)[-1]}

    @app.post("/api/campaign/rollback")
    def campaign_rollback(id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if not body.get("reason"):
            raise HTTPException(400, "a rollback needs a reason")
        out = run_cli(["evolve", "rollback", str(_campaign_dir(id)), "--reason", body["reason"]], cwd=repo)
        active = out.rsplit(" ", 1)[-1]
        return {"active": None if active == "None" else active}

    # ------------------------------------------------------------ experience and artifacts
    @app.get("/api/artifacts")
    def artifacts() -> list[dict[str, Any]]:
        return index.artifacts()

    @app.get("/api/skills")
    def skills() -> list[dict[str, Any]]:
        return index.skill_libraries()

    @app.get("/api/lessons")
    def lessons() -> list[dict[str, Any]]:
        return index.lesson_books()

    @app.get("/api/memories")
    def memories() -> list[dict[str, Any]]:
        return index.memories()

    # ------------------------------------------------------------ configs, live sandbox, jobs
    @app.get("/api/configs")
    def configs() -> dict[str, list[str]]:
        ex = repo / "examples"
        return {"experiments": sorted(str(p.relative_to(repo)) for p in (ex / "configs").glob("*.yaml")),
                "campaigns": sorted(str(p.relative_to(repo)) for p in (ex / "evolve").glob("*.yaml"))}

    @app.post("/api/live/options")
    def live_options(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            cfg = load_config(repo / body["config"], body.get("overrides"))
        except (ValueError, OSError) as exc:
            raise HTTPException(400, str(exc))
        agent = cfg.agent.model_dump(mode="json")
        return {**task_options(cfg), "name": cfg.name, "agent": agent, "trace": cfg.trace.model_dump(mode="json"),
                "safety": cfg.safety}

    @app.post("/api/live/stop")
    def live_stop() -> dict[str, Any]:
        live.stop.set()
        return {"stopping": live.busy}

    @app.websocket("/api/live")
    async def live_ws(ws: WebSocket) -> None:
        if not roles.allows(roles.role(ws.query_params.get("token")), "operator"):
            await ws.close(code=4401)
            return
        await ws.accept()
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()

        def emit(msg: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(q.put_nowait, msg)

        try:
            req = await ws.receive_json()
            req["config"] = str(repo / req["config"])
            fut = loop.run_in_executor(None, live.run, req, emit)
            while True:
                getter = asyncio.ensure_future(q.get())
                done, _ = await asyncio.wait({getter, fut}, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    await ws.send_json(getter.result())
                    continue
                getter.cancel()
                while not q.empty():
                    await ws.send_json(q.get_nowait())
                try:
                    await ws.send_json({"type": "done", **fut.result()})
                except Exception as exc:  # noqa: BLE001 - report any failure to the page
                    await ws.send_json({"type": "failed", "error": f"{type(exc).__name__}: {exc}"[:500]})
                break
        except WebSocketDisconnect:
            live.stop.set()
        finally:
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass

    @app.get("/api/jobs")
    def jobs_list() -> list[dict[str, Any]]:
        return jobs.list()

    @app.post("/api/jobs")
    def jobs_start(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return jobs.start(body["kind"], body.get("args") or {})
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, str(exc))

    @app.get("/api/jobs/{jid}/log")
    def jobs_log(jid: str, tail: int = 200) -> dict[str, str]:
        try:
            return {"log": jobs.log(jid, tail)}
        except KeyError as exc:
            raise nf(exc)

    @app.post("/api/jobs/{jid}/stop")
    def jobs_stop(jid: str) -> dict[str, bool]:
        jobs.stop(jid)
        return {"ok": True}

    # ------------------------------------------------------------ control plane: workcells and policy servers
    @app.get("/api/me")
    def me(request: Request) -> dict[str, Any]:
        return {"role": request.state.role, "roles_enforced": not roles.open}

    @app.get("/api/workcells")
    def workcells_list() -> list[dict[str, Any]]:
        return control.list_workcells()

    @app.get("/api/policies")
    def policies_list() -> list[dict[str, Any]]:
        return control.list_policies()

    @app.post("/api/workcells/{name}/episodes")
    def workcell_start(name: str, body: dict[str, Any] = Body(...)) -> Any:
        try:
            return control.start(name, body)
        except KeyError as exc:
            raise nf(exc)
        except ValidationError as exc:
            raise HTTPException(400, str(exc))
        except RuntimeError as exc:
            raise HTTPException(409, str(exc))

    @app.post("/api/workcells/{name}/operator")
    def workcell_operator(name: str, request: Request, body: dict[str, Any] = Body(...)) -> Any:
        if body.get("type") != "estop" and not roles.allows(request.state.role, "operator"):
            raise HTTPException(403, "only the e-stop is open to viewers; this needs the operator role")
        try:
            return control.operator(name, {**body, "by": body.get("by") or request.state.role})
        except KeyError as exc:
            raise nf(exc)
        except ValidationError as exc:
            raise HTTPException(400, str(exc))
        except RuntimeError as exc:
            raise HTTPException(409, str(exc))

    @app.websocket("/api/workcells/{name}/events")
    async def workcell_events(ws: WebSocket, name: str) -> None:
        import websockets

        if roles.role(ws.query_params.get("token")) is None:
            await ws.close(code=4401)
            return
        try:
            url = control.events_url(name)
        except KeyError:
            await ws.close(code=4404)
            return
        await ws.accept()
        try:
            async with websockets.connect(url, max_size=None) as upstream:
                async for msg in upstream:
                    await ws.send_text(msg if isinstance(msg, str) else msg.decode())
        except (WebSocketDisconnect, OSError, websockets.exceptions.WebSocketException) as exc:
            try:
                await ws.send_json({"type": "failed", "error": f"workcell stream: {exc!r}"[:300]})
            except Exception:  # noqa: BLE001
                pass
        finally:
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------ frontend (built React app), SPA fallback
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = (STATIC / path).resolve()
        if path and STATIC in f.parents and f.is_file():
            return FileResponse(f)
        if (STATIC / "index.html").exists():
            return FileResponse(STATIC / "index.html")
        return JSONResponse({"detail": "frontend not built: cd studio/web && npm install && npm run build"},
                            status_code=404)

    app.state.live, app.state.index = live, index
    return app


def main(argv: list[str] | None = None) -> int:
    """run the playground: run explorer, live sandbox, campaigns and the workcell control plane"""
    import argparse

    import uvicorn

    ap = argparse.ArgumentParser(prog="wc-playground")
    ap.add_argument("--root", default="runs", help="runs directory (relative to --repo)")
    ap.add_argument("--repo", default=".", help="repository root (for examples/ and job working directory)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--token", help="require this token on every API call (x-token header or ?token=)")
    ap.add_argument("--judge", help="success-judge artifact used for progress curves")
    ap.add_argument("--workcell", action="append", default=[], metavar="NAME=URL[#TOKEN]", help="a workcell service")
    ap.add_argument("--policy", action="append", default=[], metavar="NAME=WS_URL[#TOKEN]", help="a policy server endpoint")
    ap.add_argument("--role-token", action="append", default=[], metavar="ROLE=TOKEN",
                    help="viewer / operator / approver tokens (none given: the local user has every role)")
    a = ap.parse_args(argv)
    role_tokens = dict(rt.split("=", 1) for rt in a.role_token)
    bad = set(role_tokens) - {"viewer", "operator", "approver"}
    if bad:
        ap.error(f"unknown roles {sorted(bad)}")
    app = create_app(a.root, repo=a.repo, token=a.token, judge=a.judge, workcells=[Endpoint.parse(w) for w in a.workcell],
                     policies=[Endpoint.parse(p) for p in a.policy], role_tokens=role_tokens)
    print(f"worldcurrent playground on http://{a.host}:{a.port}")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
    app.state.live.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
