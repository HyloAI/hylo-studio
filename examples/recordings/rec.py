"""Recording Studio walkthroughs: headless Chromium driven like a user (eased mouse moves, clicks, scrolling,
typing), with a visible cursor, click ripples and captions injected into the page, recorded by Playwright and
encoded to H.264 mp4 with a poster frame."""

from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Callable

OVERLAY = r"""
(() => {
  if (window.__hyloRec) return; window.__hyloRec = true;
  const css = `
  #rec-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
    transform:translate(-3px,-2px)}
  .rec-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;z-index:2147483646;
    pointer-events:none;border:2px solid rgba(214,69,45,.9);animation:recr .55s ease-out forwards}
  @keyframes recr{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
  #rec-cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:78%;z-index:2147483645;
    pointer-events:none;background:rgba(20,22,26,.88);color:#fff;font:500 17px/1.45 Inter,system-ui,sans-serif;
    padding:10px 18px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .35s;
    text-align:center}
  #rec-cap.on{opacity:1}
  #rec-cap b{color:#ff9b85;font-weight:600}`;
  const add = () => {
    if (document.getElementById('rec-cursor') || !document.body) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'rec-cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13.2 19.3 L10.3 13 L16.5 13 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = 'rec-cap'; document.body.appendChild(cap);
    const pos = window.__recPos || [640, 400]; c.style.left = pos[0] + 'px'; c.style.top = pos[1] + 'px';
  };
  document.addEventListener('mousemove', (e) => { window.__recPos = [e.clientX, e.clientY];
    const c = document.getElementById('rec-cursor'); if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; } }, true);
  document.addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = 'rec-ripple';
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  window.__caption = (html) => { add(); const cap = document.getElementById('rec-cap');
    if (!html) { cap.classList.remove('on'); return; } cap.innerHTML = html; cap.classList.add('on'); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  new MutationObserver(add).observe(document.documentElement, {childList: true});
})();
"""


class Rec:
    """The recorder's hands: every move is eased, every click shows a ripple, captions sit at the bottom."""

    def __init__(self, page, w: int, h: int) -> None:
        self.page, self.w, self.h = page, w, h
        self.x, self.y = w * 0.5, h * 0.55

    def wait(self, ms: int) -> None:
        self.page.wait_for_timeout(ms)

    def caption(self, html: str | None, hold: int = 0) -> None:
        self.page.evaluate("(h) => window.__caption && window.__caption(h)", html)
        if hold:
            self.wait(hold)

    def move(self, x: float, y: float, ms: int = 650) -> None:
        steps = max(8, ms // 16)
        x0, y0 = self.x, self.y
        for i in range(1, steps + 1):
            t = i / steps
            e = t * t * (3 - 2 * t)
            self.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
            self.page.wait_for_timeout(16)
        self.x, self.y = x, y

    def to(self, locator, ms: int = 650) -> None:
        locator.scroll_into_view_if_needed()
        b = locator.bounding_box()
        self.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, ms)

    def click(self, locator, ms: int = 650, after: int = 700) -> None:
        self.to(locator, ms)
        self.wait(180)
        self.page.mouse.down()
        self.page.wait_for_timeout(90)
        self.page.mouse.up()
        self.wait(after)

    def scroll(self, dy: int, ms: int = 1200) -> None:
        steps = max(10, ms // 30)
        for _ in range(steps):
            self.page.mouse.wheel(0, dy / steps)
            self.page.wait_for_timeout(30)

    def type(self, text: str, delay: int = 55) -> None:
        self.page.keyboard.type(text, delay=delay)

    def fill(self, locator, text: str, delay: int = 14) -> None:
        """Replace a field's text by typing, as a person would."""
        self.click(locator, after=200)
        self.page.keyboard.press("Control+A")
        self.page.keyboard.press("Delete")
        self.type(text, delay)
        self.wait(400)


def ffmpeg() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def to_mp4(webm: Path, out: Path, skip_s: float, crf: int = 28) -> None:
    """H.264 for the web (yuv420p, faststart) without the blank lead-in, and a poster frame at 3 s."""
    out.parent.mkdir(parents=True, exist_ok=True)
    exe = ffmpeg()
    subprocess.run([exe, "-y", "-loglevel", "error", "-ss", f"{skip_s:.2f}", "-i", str(webm), "-c:v", "libx264",
                    "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out)],
                   check=True)
    subprocess.run([exe, "-y", "-loglevel", "error", "-ss", "3", "-i", str(out), "-frames:v", "1", "-q:v", "3",
                    str(out.with_suffix(".jpg"))], check=True)


def duration(path: Path) -> float:
    r = subprocess.run([ffmpeg(), "-i", str(path)], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if "Duration:" in line:
            h, m, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
            return round(int(h) * 3600 + int(m) * 60 + float(s), 1)
    return 0.0


def record(url: str, out: Path, script: Callable, w: int = 1280, h: int = 800, theme: str = "light") -> dict:
    """Run `script(page, rec, url)` in a fresh recorded browser context. The script returns the monotonic time at
    which its first real content was on screen; everything before it is cut."""
    from playwright.sync_api import sync_playwright

    raw = out.parent / (out.stem + "-raw")
    raw.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": w, "height": h}, record_video_dir=str(raw),
                                  record_video_size={"width": w, "height": h}, color_scheme=theme)
        ctx.add_init_script(OVERLAY)
        page = ctx.new_page()
        t0 = time.monotonic()
        start = script(page, Rec(page, w, h), url)
        video = Path(page.video.path())
        ctx.close()
        browser.close()
    to_mp4(video, out, max(0.0, (start or t0) - t0))
    for f in raw.iterdir():
        f.unlink()
    raw.rmdir()
    return {"file": str(out), "kb": out.stat().st_size // 1024, "seconds": duration(out)}
