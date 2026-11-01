# hylo-studio

Part of [Hylo](https://hyloai.github.io/), the stack for physical AI. This repository is **Hylo Studio**, the
**workbench** layer.

The playground: one web UI over runs, campaigns, learning artifacts and workcells. `packages/hylo-playground` is the
FastAPI backend and control plane (`hylo playground`); `web/` is the React front end, built into the package.

The control plane never sends actions. It starts episodes on workcells (the workcell API, hylo.workcell/v0.1),
relays operator input with roles (viewer < operator < approver; the e-stop is open to every role) and runs `hylo`
commands as jobs. It reads runs and campaigns through the harness's catalog.

```bash
cd web && npm install --ignore-scripts && npm run build && cd ..
uv run hylo playground --repo ../bench \
  --workcell sim-arm=http://127.0.0.1:8102 --policy wave=ws://127.0.0.1:8002/hylo       # http://127.0.0.1:8765
```

`--repo` is the working directory the UI shows (`examples/configs`, `examples/evolve`, `runs/`) and runs jobs in.
Pages and options: [web/README.md](web/README.md).

Documentation (hylo-docs, `uv run mkdocs serve -f docs/mkdocs.yml` from the workspace): [studio](../docs/docs/user-guide/studio.md).

## License

Apache License 2.0 (see [LICENSE](LICENSE)). Copyright 2026 Hylo AI.
