"""Camera images for the browser: RGB unchanged, depth maps and segmentation maps made visible."""

import numpy as np

from hylo.playground.render import displayable, jpeg


def test_rgb_is_unchanged():
    img = np.random.default_rng(0).integers(0, 255, (8, 10, 3), dtype=np.uint8)
    assert displayable(img) is img or np.array_equal(displayable(img), img)


def test_depth_nearer_is_brighter_and_invalid_is_black():
    d = np.array([[0.5, 1.0, 2.0], [np.nan, 0.0, np.inf]], np.float32)
    g = displayable(d)
    assert g.dtype == np.uint8 and g.shape == d.shape
    assert g[0, 0] == 255 and g[0, 0] > g[0, 1] > g[0, 2] >= 40      # metres: nearer is brighter
    assert (g[1] == 0).all()                                         # nan, 0 and inf are not depths


def test_segmentation_gets_a_colour_per_id():
    s = np.array([[0, 1, 1], [2, 5, -1]], np.int32)
    c = displayable(s)
    assert c.shape == (2, 3, 3) and c.dtype == np.uint8
    assert (c[0, 0] == 0).all() and (c[1, 2] == 0).all()             # background black
    assert np.array_equal(c[0, 1], c[0, 2])                          # same id, same colour
    assert not np.array_equal(c[0, 1], c[1, 0]) and c[1, 1].max() >= 60


def test_jpeg_accepts_every_kind():
    for a in (np.zeros((4, 4, 3), np.uint8), np.ones((4, 4), np.float32), np.ones((4, 4), np.int32)):
        assert jpeg(a)[:2] == b"\xff\xd8"
