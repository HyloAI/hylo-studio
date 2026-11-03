# Examples

Runnable examples of the workbench layer: a demo store that fills every Studio page in about half a minute, built
only with the commands a user would type, and a script that screenshots every page in headless Chromium.

```bash
cd web && npm install --ignore-scripts && npm run build && cd ..     # once: the web bundle
uv run python examples/01_demo_store.py                              # from the studio repository; open the URL it prints
```

The default output is `runs/examples/<slug>/`; each script writes `result.json`.

## Results

Measured on 2026-11-01 (128-core CPU, no GPU).

| Example | What it shows | Command | Measured result | Runtime |
|---|---|---|---|---|
| `01_demo_store.py` | A self-contained store (two mujoco-reach scorecards, a gain campaign, a sealed k-NN artifact, operated workcell episodes on the simulated arm), the playground on it with the workcell and policy server behind the Operator page, one job started from the Jobs API; `--check` queries every page's API and stops | `uv run python examples/01_demo_store.py [--check]` | Playground ready 34.0 s after the start (store 33.3 s: campaign 15.6 s, workcell episodes 10.2 s, bench runs 5.5 s); 15 runs, 742 episodes, 1 campaign, 1 artifact; all 8 pages answer 200, API p50 at most 3.3 ms per page; scorecard comparison kp 0.30 vs kp 0.02: 59 wins, 0 losses in 100 pairs, p = 1.7e-18 | 34 s (`--quick` 30 s) |
| `02_screenshots.py` | Every page in headless Chromium at 1440x900: Jobs, Live and Operator driven like a user on the demo store; the read-only pages from `--rich-repo` (here a bench working directory with recorded LIBERO-10 runs, only read) | `uv run --with playwright python examples/02_screenshots.py --rich-repo DIR` | 11 PNGs, 84 to 411 KB, all lossless (limit 500 KB) | 73 s |
| `02_screenshots.py --only-research` | The Research pages only, from `--research-repo` (the workspace, whose `runs/` holds the research sessions of the stacking campaign; only read) with the code-agent examples as an extra session root | `uv run --with playwright python examples/02_screenshots.py --only-research [--research-repo DIR]` | 6 PNGs, 99 to 368 KB, all lossless; 34 sessions listed (21 research sessions, 6 scene-builder, 6 motion-studio, 1 replay gallery) | 10 s |
| `03_recordings.py` | Six video walkthroughs (1280x800 mp4 and a poster each) in headless Chromium, driven like a user with a visible cursor and captions: self-improvement (cascade, an LLM campaign that promoted nothing, an approval, the rollback form, the A/B arena), Experience, Research to program skill, World (build, orbit, an action and a goal check, a chat transcript), Live (a tool-calling agent with qwen3.5 on Ollama) and `hylo watch` in a terminal. Recorded runs are named in a sources file (`recordings/sources.example.json`) and only read; the campaigns scene runs a fresh manual-approval campaign | `uv run --with playwright python examples/03_recordings.py --sources SOURCES.json [--only NAMES]` | 6 videos, 38 to 93 s each, 629 to 1476 KB (campaigns 76 s, experience 38 s, research 46 s, world 57 s, live 93 s, terminal 54 s); the live episode succeeded in 127 steps | about 7 min |

## Pages

The read-only pages show recorded LIBERO-10 and MuJoCo runs (`--rich-repo`); Jobs, Live and Operator show the demo
store.

**Overview**: the improvement loop's funnel across campaigns, the last live episode, the strongest gate result,
the success judge's calibration and the recent runs.

![Overview](assets/overview.png)

**Runs**: every recorded run by split, agent, episodes, success and safety interventions per episode.

![Runs](assets/runs.png)

**Run**: one run's outcome for every task and init state, per-task success, its configuration.

![Run](assets/run.png)

**Episode replay**: both cameras, the action traces, chunk boundaries, every policy call and the event log.

![Episode replay](assets/episode.png)

**Compare (A/B arena)**: two runs paired on task and init state: wins and losses, the one-sided McNemar p, per-task
deltas, every pair.

![Compare](assets/compare.png)

**Campaigns**: every improvement campaign with its cycles, candidates and outcome.

![Campaigns](assets/campaigns.png)

**Campaign**: cycles, candidates with their hypotheses, early check, search_val and gate looks, verdicts and vetoes;
approve or roll back (approver role).

![Campaign](assets/campaign.png)

**Experience**: skills with their evidence and status, lessons, action memories and sealed artifacts.

![Experience](assets/experience.png)

**Jobs**: start `hylo run`, `hylo evolve run` or `hylo calibrate` in the background and follow the log.

![Jobs](assets/jobs.png)

**Live sandbox**: one episode of an experiment config through the real kernel and SafetyShield, streamed step by
step.

![Live sandbox](assets/live.png)

**Operator station**: run episodes on a workcell with a chosen policy server, confirm resets, judge outcomes,
stop; the e-stop is open to every role.

![Operator station](assets/operator.png)

## Research pages

The Research pages read research sessions and code-agent runs straight from their files. These screenshots show the
session `runs/campaign/research/base-r0` of the workspace: `gpt-oss:20b` wrote a stacking program in 30 turns,
solved all three development cases with its first submission, and the campaign promoted the frozen program.

**Research**: every session with its model, task, best development score, turns against the budget, tokens,
cost, wall time and stop reason; scene-builder, motion-studio and replay runs from `--sessions` directories.

![Research](assets/research.png)

**Session**: the figures, the campaign candidate the frozen program became (promoted, the active version), prompt
tokens with their cached part and model latency per turn with the submitting turns marked, the usage totals, and
the start of the timeline.

![Research session](assets/research-session.png)

**Turns**: the code each turn ran, its printed output, and a submission with its outcome on every development case.

![Research turns](assets/research-turn.png)

**Frozen program**: the sealed `solve.py` with line numbers and highlighting, its digest, entry point, development
result, model and provenance.

![Frozen program](assets/research-program.png)

**Camera views**: the views a vision model asked for (`robot.show`), at their own resolution under the turn's
output (`runs/research/qwen-press_by_number`, an interrupted session without a summary).

![Camera views](assets/research-images.png)

**Scene-builder run**: a code-agent run from the examples root with its usage and the episode video.

![Scene-builder run](assets/research-scene.png)

## Notes

- The demo store's Experience page has only the Artifacts tab populated: skills come from steering campaigns and
  lessons from an LLM reflector, neither of which runs here without a GPU or a model server.
- MuJoCo renders no camera frames on this machine (no OpenGL), so the Live screenshot's camera panels are empty;
  the action traces and event log are live. The Operator page shows the simulated arm's own camera.
- Chromium needs system libraries (libatk, libgbm, libasound, ...). Without root, unpack them into a directory and
  point `LD_LIBRARY_PATH` at it; that is how these screenshots were taken.
- Taking the screenshots exposed a display bug, fixed in
  `packages/hylo-playground/src/hylo/playground/jobs.py` (`JobManager.start`): a job's `cmd` kept the module name,
  so the Jobs page showed `hylo hylo.core.cli run ...` instead of `hylo run ...`.
- `--rich-repo` defaults to `$HYLO_SCREENSHOT_REPO`; without it every page comes from the demo store.
- `--research-repo` defaults to `$HYLO_RESEARCH_REPO`, else the directory above the studio repository when its
  `runs/campaign/research/base-r0` exists; without one the Research screenshots are skipped.
- Taking the Research screenshots exposed layout problems, fixed before these were taken: the session table ran past
  the panel (the model now sits under the task, long cells end in an ellipsis), and camera views were squeezed into
  narrow grid columns (they now show at their own width, up to the column).
- `03_recordings.py` found three Studio defects, fixed before these recordings: depth and segmentation frames showed black in the Live sandbox and in replays (float depth and integer ids were cast to 8 bits; they are now shown as grey depth, nearer brighter, and one colour per id), and the Live page could show the error of an earlier config's options request after a later one had loaded.
