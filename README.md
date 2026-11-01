# worldcurrent-studio

The playground: one web UI over runs, campaigns, learning artifacts and workcells. `packages/wc-playground` is the
FastAPI backend and control plane (`wc playground`); `web/` is the React front end, built into the package.

The control plane never sends actions. It starts episodes on workcells (the workcell API, wc.workcell/v0.1),
relays operator input with roles (viewer < operator < approver; the e-stop is open to every role) and runs `wc`
commands as jobs. It reads runs and campaigns through the harness's catalog.

```bash
cd web && npm install --ignore-scripts && npm run build && cd ..
uv run wc playground --repo ../bench \
  --workcell sim-arm=http://127.0.0.1:8102 --policy wave=ws://127.0.0.1:8002/wc       # http://127.0.0.1:8765
```

`--repo` is the working directory the UI shows (`examples/configs`, `examples/evolve`, `runs/`) and runs jobs in.
Pages and options: [web/README.md](web/README.md).
