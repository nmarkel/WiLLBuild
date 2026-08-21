"""Recover a spec sheet's photometric diagrams as geometry.

WiLL's spec sheets plot the real isolux contours per distribution (GVX: page 5,
"Photometric Diagrams", simulated per IESNA LM-63-1995, every plot at 15 ft
mounting height and 0 deg tilt). The night view used to draw one fixed ellipse
whatever the customer picked; this reads the sheet's own contours so the beam
shape comes from WiLL's photometry instead of from a guess.

The plots are VECTOR art, so nothing here is traced by eye: `pdf_paths` walks
the page's content stream (and its Form XObjects) and returns stroked paths with
their colour, the legend colour identifies the footcandle level, and the black
grid gives the scale — each frame spans -100 ft to +100 ft.

Output is a polar profile per distribution, in MOUNTING HEIGHTS, so it scales to
whatever pole the customer configures:

    curl -o gvx.pdf https://docs.willbrands.com/willstudio-gvx-pendant.pdf
    geometry-service/.venv/bin/python scripts/photometry/extract_isolux.py \
        gvx.pdf src/lib/isoluxProfiles.ts

Every WiLL spec sheet lives at `docs.willbrands.com/<product-handle>.pdf` (the
handle is on the product page's own PDF link, NOT always the page slug: the
poles are `willstudio-rsax-deco-poles`, the arms `willstudio-deco-arms`, the
base covers `willstudio-deco-base-covers`).

Re-run it when a spec sheet revision changes the diagrams (GVX source revision
is recorded in the generated header).
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pdf_paths import page_paths  # noqa: E402

#: Legend on page 5, in footcandles.
FC_BY_COLOR = {
    (0.573, 0.153, 0.561): 0.5,
    (0.11, 0.459, 0.737): 2.0,
    (1.0, 0.949, 0.0): 5.0,
    (0.961, 0.498, 0.125): 10.0,
    (0.929, 0.11, 0.141): 25.0,
}
#: Reading order of the eight plots (verified against the captions).
CODES = ["1S", "2M", "3M", "3W", "4M", "5W", "5M", "5N"]
GRID_FT = 200.0  # each frame spans -100 ft .. +100 ft
MOUNT_FT = 15.0  # "15' Height @ 0 deg" on every plot
#: Every level the sheet plots, brightest first. The viewer stacks them, which
#: is what gives the beam a falloff instead of one flat step: a plot only draws
#: the levels that fit its grid, so a distribution carries as many as it has.
LEVELS = (25.0, 10.0, 5.0, 2.0, 0.5)
BINS = 48  # angular samples per contour


def _cluster(values, gap):
    values = sorted(values)
    groups, current = [], [values[0]]
    for value in values[1:]:
        if value - current[-1] > gap:
            groups.append(current)
            current = [value]
        else:
            current.append(value)
    groups.append(current)
    return groups


def plot_frames(paths):
    """The eight axis frames, in page points, in reading order."""
    mids = []
    for path in paths:
        if path["stroke"] != (0.0, 0.0, 0.0):
            continue
        for a, b in zip(path["pts"], path["pts"][1:]):
            mids.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))

    frames = []
    for band in _cluster([m[1] for m in mids], 25):
        row = [m for m in mids if band[0] - 2 <= m[1] <= band[-1] + 2]
        for col in _cluster([m[0] for m in row], 18):
            cell = [m for m in row if col[0] - 2 <= m[0] <= col[-1] + 2]
            if len(cell) < 30:
                continue
            x0, x1 = min(m[0] for m in cell), max(m[0] for m in cell)
            y0, y1 = min(m[1] for m in cell), max(m[1] for m in cell)
            if min(x1 - x0, y1 - y0) < 80:
                continue
            frames.append((x0, y0, x1, y1))
    frames.sort(key=lambda f: (-round(f[3]), f[0]))
    return frames


def polar_profile(points, bins=BINS):
    """Radius per angular bin, as a star-shaped approximation of a contour.

    Isolux contours around a light point are star-shaped about it, so binning
    by angle and taking the largest radius in each bin recovers the outline
    without having to chain hundreds of stroked fragments back together.
    """
    radii = [0.0] * bins
    for x, y in points:
        r = math.hypot(x, y)
        if r <= 0:
            continue
        bin_index = int(((math.atan2(y, x) + math.pi) / (2 * math.pi)) * bins) % bins
        radii[bin_index] = max(radii[bin_index], r)
    # Fill any bin the sampling missed from its neighbours.
    for i, r in enumerate(radii):
        if r > 0:
            continue
        before = next((radii[(i - k) % bins] for k in range(1, bins) if radii[(i - k) % bins] > 0), 0.0)
        after = next((radii[(i + k) % bins] for k in range(1, bins) if radii[(i + k) % bins] > 0), 0.0)
        radii[i] = (before + after) / 2 if before and after else max(before, after)
    return radii


def extract(pdf: Path, page_index: int = 4):
    paths = page_paths(str(pdf), page_index)
    frames = plot_frames(paths)
    if len(frames) != len(CODES):
        raise SystemExit(f"expected {len(CODES)} plots, found {len(frames)}")

    out = {}
    for code, (fx0, fy0, fx1, fy1) in zip(CODES, frames):
        cx, cy = (fx0 + fx1) / 2, (fy0 + fy1) / 2
        ft_per_pt = GRID_FT / max(fx1 - fx0, fy1 - fy0)
        by_level = {}
        for path in paths:
            fc = FC_BY_COLOR.get(path["stroke"])
            if fc not in LEVELS:
                continue
            pts = path["pts"]
            if not all(fx0 - 3 <= x <= fx1 + 3 and fy0 - 3 <= y <= fy1 + 3 for x, y in pts):
                continue  # a fragment of a neighbouring plot
            by_level.setdefault(fc, []).extend(
                ((x - cx) * ft_per_pt / MOUNT_FT, (y - cy) * ft_per_pt / MOUNT_FT) for x, y in pts
            )
        if 2.0 not in by_level or 0.5 not in by_level:
            raise SystemExit(f"{code}: no 2.0/0.5 fc contour ({sorted(by_level)})")
        out[code] = {
            str(level): [round(r, 4) for r in polar_profile(by_level[level])]
            for level in LEVELS
            if level in by_level
        }
    return out


def source_revision(pdf: Path) -> str:
    try:
        text = subprocess.run(
            ["pdftotext", "-f", "5", "-l", "5", str(pdf), "-"],
            capture_output=True, text=True, check=True,
        ).stdout
        match = re.search(r"Rev\.\s*(\S+)", text)
        return match.group(1) if match else "unknown"
    except Exception:
        return "unknown"


def main() -> None:
    pdf = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    profiles = extract(pdf)
    rev = source_revision(pdf)
    body = json.dumps(profiles, indent=2, sort_keys=True)
    out_path.write_text(
        f'''/**
 * GENERATED — do not hand-edit.
 *   scripts/photometry/extract_isolux.py {pdf.name} {out_path.name}
 *
 * WiLL's own isolux contours for the GVX, read off the spec sheet's vector
 * artwork (page 5, "Photometric Diagrams", simulated per IESNA LM-63-1995,
 * every plot at 15 ft mounting height and 0 deg tilt). Source revision: {rev}.
 *
 * Each distribution carries one polar profile per footcandle level: {BINS} radii,
 * in MOUNTING HEIGHTS, starting at the plot's -X axis and going anticlockwise.
 * Mounting heights rather than feet so the same contour scales to whatever pole
 * the customer configures.
 *
 * Keys are footcandle levels. Every distribution has 2.0 (the lit pool) and 0.5
 * (the faint outer edge); the brighter levels appear only where the sheet's own
 * plot draws them, which is why 5W carries two contours and 5N carries five.
 */
export const ISOLUX_BINS = {BINS}

export const ISOLUX_PROFILES: Record<string, Record<string, number[]>> = {body} as const
''',
        encoding="utf-8",
    )
    print(f"wrote {out_path} — {len(profiles)} distributions, {BINS} bins, source rev {rev}")


if __name__ == "__main__":
    main()
