# Viewer backdrop scenes — sources & license

Daytime backdrop photos for the compositing viewer's scene picker (Park /
Street side / Courtyard). Each is cropped to **1600×1000** so its near, flat
foreground ground plane falls across the pin fraction **`HORIZON_FRAC = 0.80`**
(base sits 80% down) — so the product's foot + contact shadow land on the near
foreground ground of every backdrop and one placement grounds identically
across all three (see `src/components/CompositeViewer.tsx`).

**Status: interim.** These are real stock photos standing in until final WiLL
brand photography. A final image drops into the same slot (same filename, same
0.72 ground line, 1600×1000) with **no code change**.

## License

All three are from **Pexels** under the [Pexels License](https://www.pexels.com/license/):
free for commercial and personal use, no attribution required, no sign-up.

| Scene | File | Pexels photo | Source page |
|-------|------|--------------|-------------|
| Park | `park.jpg` | ID 17952424 | https://www.pexels.com/photo/17952424/ |
| Street side | `street.jpg` | ID 38336361 | https://www.pexels.com/photo/38336361/ |
| Courtyard | `courtyard.jpg` | ID 7109805 | https://www.pexels.com/photo/7109805/ |

## Processing

Downloaded at `w=1600` from the Pexels CDN, then cropped to 1600×1000 with an
offset (`sips -c 1000 1600 --cropOffset <y> 0`) chosen so the ground line lands
at ~0.72, and re-encoded JPEG q62. Night mode dims the backdrop via
`.composite-viewer.night .composite-backdrop` in `index.css`.
