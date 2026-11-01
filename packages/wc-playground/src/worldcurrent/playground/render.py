"""Image encoding for the browser."""

from __future__ import annotations

import io
from typing import Any

import numpy as np


def jpeg(img: Any, quality: int = 85) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(np.asarray(img, dtype=np.uint8)).save(buf, format="JPEG", quality=quality)
    return buf.getvalue()
