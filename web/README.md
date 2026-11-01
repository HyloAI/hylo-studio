# Hylo playground (web)

A local demo UI over the Hylo stack. The backend is the Python package `../packages/hylo-playground` (FastAPI);
this directory is the React frontend.

| Page | What it shows / does |
|---|---|
| Overview | runs, campaigns, artifacts at a glance |
| Live sandbox | run one episode of any experiment config (LIBERO + SmolVLA, MuJoCo) through the real kernel and safety shield, streamed frame by frame; change the task, init state, the instruction the agent sees, steering knobs and other overrides (safety / benchmark / trace / scoring are protected); stop at any time |
| Runs | every recorded run; per-task success; episode replay with camera frames, executed actions, chunk boundaries, safety interventions and the success judge's estimate |
| Compare | two runs paired on (task, seed): wins / losses, exact one-sided McNemar p, per-task deltas, side-by-side replays of discordant pairs |
| Self-improvement | campaigns, cycles, candidates with hypotheses, search_val and group-sequential gate statistics, vetoes, ledger; approve a pending candidate or roll back |
| Experience & learning | skills, lessons, action memories, sealed artifacts with provenance and calibration |
| Jobs | start `hylo run`, `hylo evolve run`, `hylo calibrate` in the background and follow their logs |
| Operator station | run episodes on a workcell (real robot or simulator) with a chosen policy server; confirm resets, judge outcomes (success / partial / failure), stop; the e-stop is always available |

## Run

```bash
# once: Node >= 18 (a user-space install works: ~/.local/opt/node/bin on PATH)
cd web && npm install --ignore-scripts && npm run build      # from the studio repository; builds into the Python package
uv run hylo playground --repo ../bench                          # http://127.0.0.1:8765; --repo: the working directory
```

Development with hot reload: run `uv run hylo-playground` and, in this directory, `npm run dev` (Vite proxies `/api`).

As a control plane: `uv run hylo-playground --workcell sim-arm=http://127.0.0.1:8102 --policy wave=ws://127.0.0.1:8002/hylo`
(start the policy server and the workcell first, see the deployments template's workcells/). Roles: `--role-token viewer=... --role-token
operator=... --role-token approver=...`; without them the local user has every role.

The server binds to 127.0.0.1. `--token SECRET` requires the token on every API call (open the UI once with
`?token=SECRET`). `--repo` is the working directory whose `examples/configs`, `examples/evolve` and `runs/` the UI shows and
whose jobs it runs (a bench checkout). Live episodes are saved under `runs/playground/live/` with split `playground`, which no learner or
gate ever reads.
