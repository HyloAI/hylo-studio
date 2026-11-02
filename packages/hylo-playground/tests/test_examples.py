"""Smoke test: the demo-store example builds its store, starts the playground and every page's API answers.
(The screenshot example needs Playwright and Chromium; it is not run here.)"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
STATIC = Path(__file__).resolve().parents[1] / "src" / "hylo" / "playground" / "static" / "index.html"


@pytest.mark.skipif(not STATIC.exists(), reason="web bundle not built (cd web && npm install --ignore-scripts && npm run build)")
def test_demo_store_populates_every_page(tmp_path):
    out = tmp_path / "store"
    res = subprocess.run([sys.executable, str(EXAMPLES / "01_demo_store.py"), "--quick", "--check", "--out", str(out)],
                         cwd=EXAMPLES.parent, capture_output=True, text=True, timeout=300)
    assert res.returncode == 0, res.stdout[-2000:] + res.stderr[-3000:]
    result = json.loads((out / "result.json").read_text())
    s = result["summary"]
    assert s["all_pages_200"] and s["job"] == "done"
    assert s["runs"] >= 10 and s["campaigns"] == 1 and s["artifacts"] == 1
    pages = {p["page"]: p for p in result["pages"]}
    assert pages["Operator"]["items"][1:] == [1, 1]                  # one workcell, one policy server
    assert pages["Compare"]["items"][1] == 100                         # 100 paired episodes
    assert result["workcell_episodes"][0]["verdict"]["verdict"] == "success"
