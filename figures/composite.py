"""Lays the ghost layers from figures/publications.py over their picture and writes the result as WebP.

  python3 figures/composite.py TILES_DIR OUT_DIR nmpc admm hier thesis gpu:bones-seed-gpu

Each name is a scene; it is written as pub-<scene>.webp, or as <file>.webp when given as scene:file.

A ghost is one flat, even layer of the hero's orange, blended over the picture as the browser blends the hero's
ghosts: its layer's alpha says where it is, its color only how the light falls on it (a little, for form).
The pictures have no backdrop, so the result keeps its transparency: objects, their softened shadows, ghosts.
"""
import os
import sys

import numpy as np
from PIL import Image

SHADOW = 0.42                                         # how dark the floor shadows are allowed to get
FADE = 0.09                                           # shadows fade out over this much of the picture, at each edge
ORANGE = np.array([255, 138, 77], dtype=np.float32)  # #ff8a4d, the hero's ghost color
OPACITY = [0.5, 0.26, 0.13]                           # by rank: each about half as solid as the one before
FORM = 0.22                                           # how much of the shading shows

tiles, out = sys.argv[1], sys.argv[2]
for arg in sys.argv[3:]:
  name, _, dest = arg.partition(":")
  dest = dest or f"pub-{name}"
  pic = np.asarray(Image.open(f"{tiles}/{name}.png").convert("RGBA"), dtype=np.float32)
  rgb, alpha = pic[..., :3], pic[..., 3:4] / 255  # the objects; transparent wherever there is nothing
  # The floor shadows are whatever the shadow layer covers that the objects do not. They go under the objects,
  # lightened, and fade to nothing before the edges so the picture has no outline on the page.
  with_shadow = np.asarray(Image.open(f"{tiles}/{name}_shadow.png").convert("RGBA"), dtype=np.float32)[..., 3:4] / 255
  shadow = np.clip((with_shadow - alpha) / np.maximum(1 - alpha, 1e-3), 0, 1) * (alpha < 0.999)
  h, w = shadow.shape[:2]
  ramp = lambda n: np.clip(np.minimum(np.arange(n), n - 1 - np.arange(n)) / (FADE * n), 0, 1)  # noqa: E731
  smooth = lambda t: t * t * (3 - 2 * t)  # noqa: E731
  shadow = shadow * SHADOW * (smooth(ramp(h))[:, None] * smooth(ramp(w))[None, :])[..., None]
  both = alpha + shadow * (1 - alpha)
  rgb = rgb * alpha / np.maximum(both, 1e-6)  # the shadow itself is black
  alpha = both
  for k, opacity in reversed(list(enumerate(OPACITY))):  # the farthest ahead first
    path = f"{tiles}/{name}_ghost{k}.png"
    if not os.path.exists(path):
      continue
    layer = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32)
    cover = layer[..., 3:4] / 255
    light = layer[..., :3].mean(axis=-1, keepdims=True)
    light = np.clip(light / max(np.percentile(light[cover[..., 0] > 0.5], 95), 1), 0, 1) if (cover > 0.5).any() else light * 0
    color = ORANGE * (1 - FORM + FORM * light)
    a = cover * opacity
    both = a + alpha * (1 - a)  # the ghost over the picture, each with its own transparency
    rgb = (color * a + rgb * alpha * (1 - a)) / np.maximum(both, 1e-6)
    alpha = both
  done = np.concatenate([np.clip(rgb + 0.5, 0, 255), np.clip(alpha * 255 + 0.5, 0, 255)], axis=-1).astype(np.uint8)
  Image.fromarray(done).save(f"{out}/{dest}.webp", "WEBP", quality=90, method=6)
  print(f"{out}/{dest}.webp")
