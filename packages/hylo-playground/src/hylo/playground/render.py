"""Image encoding for the browser."""

from __future__ import annotations

import io
from typing import Any

import numpy as np


def displayable(img: Any) -> np.ndarray:
    """An 8-bit image a browser can show. RGB stays as it is; a float depth map becomes grey, nearer brighter (invalid
    pixels black); an integer segmentation map gets one fixed colour per id (ids below 1 black)."""
    a = np.asarray(img)
    if a.dtype == np.uint8:
        return a
    if a.ndim == 3 and a.shape[-1] == 1:
        a = a[..., 0]
    if a.dtype == np.bool_:
        return a.astype(np.uint8) * 255
    if np.issubdtype(a.dtype, np.floating):
        valid = np.isfinite(a) & (a > 0)
        out = np.zeros(a.shape, np.uint8)
        if valid.any():
            lo, hi = float(a[valid].min()), float(a[valid].max())
            near = 1.0 - (a[valid] - lo) / max(hi - lo, 1e-9)
            out[valid] = (40 + 215 * near).astype(np.uint8)
        return out
    if np.issubdtype(a.dtype, np.integer) and a.ndim == 2:
        ids = a.astype(np.int64)
        h = (ids * 2654435761) & 0xFFFFFF                 # a fixed, well-spread colour per id
        rgb = np.stack([(h >> 16) & 255, (h >> 8) & 255, h & 255], -1).astype(np.uint8)
        rgb = np.maximum(rgb, 60)
        rgb[ids < 1] = 0
        return rgb
    return np.clip(a, 0, 255).astype(np.uint8)


def jpeg(img: Any, quality: int = 85) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(displayable(img)).save(buf, format="JPEG", quality=quality)
    return buf.getvalue()
