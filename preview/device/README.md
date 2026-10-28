# Device probe — WeChat DevTools (390×844 @ DPR3 iPhone 12/13, devtools simulator)

Method: project copied to `/tmp/weapp-device-probe` (repo untouched); miniprogram-automator over
`ws://127.0.0.1:9420`; 25 ms polling of `getCurrentPages()[].selectComponent('#home-ocean').data`
plus temporary timing hooks in the /tmp copy; capability tests rendered on a temporary probe page
(`pages/probe/probe`, /tmp copy only). The devtools screenshot API returns 734×1588, i.e. the
simulator's display raster (1.882 px/CSS px), **not** 3× device pixels — true 3× pixel snapping
cannot be validated in DevTools.

## Capability matrix (WeChat DevTools simulator)

| capability | verdict | evidence |
|---|---|---|
| `repeating-linear-gradient` 0.55px hairlines @42px | YES — renders 0.5/0.55/0.6/1/2px distinctly, no gaps, 42px pitch exact | cap-grid-hairlines.png |
| `-webkit-mask-image` / `mask-image` gradient fade | YES — both compute to the linear-gradient; grid lines and a solid block fade to transparent toward the bottom | cap-mask-fade.png |
| `mix-blend-mode: screen` on `<image>` | YES — black-background PNG over a bright gradient: right half drops the black (screen), left shows the black box | cap-screenblend.png |
| SVG in `<image>` — `/assets/ocean/whale-dots.svg` (15,499 B) | YES — vector dots render crisp (200px box); `data:image/svg+xml;base64` in `<image>` also renders | cap-svg-image.png |
| `115vw`×`115vw` square, centred 55%/34%, overflow hidden | YES — computed width/height 448.5px, clipped correctly, no horizontal overflow; `transform` animation runs (matrix samples change: -225.65,-225.178 → -225.338,-224.956) | cap-composite.png |
| composite layer stack (poster data-URI jpeg + grid + whale + depth) | YES — all layers render in one pass | cap-composite.png |
| `background-size: 546px 546px` on `data:image/svg+xml` grid tile | YES — parsed and computed in WXSS | cap-composite.png |

## First-frame timeline (reLaunch → /pages/home/home, 3 runs each)

| milestone | BEFORE (WebGL + fallback) | AFTER (static layers + fluid) |
|---|---|---|
| component ready | 686–883 ms | 572–600 ms |
| static composition usable | fallback = blurred 40px whale PNG, load 783–989 ms | poster+grid at first paint; whale SVG decoded 677–698 ms |
| first real/render frame payload | 950–1180 ms (WebGL JPEG) | 684–706 ms (fluid JPEG) |
| image decode (bindload) | 982–1180 ms | 700–723 ms |
| crossfade done | n/a | 1212–1235 ms (520 ms fade) |

So: first non-fallback frame ≈ **1.0–1.2 s before** vs ≈ **0.70 s after**; and after is already
visually complete (crisp grid + whale) at the first paint (~0.6 s + SVG decode 0.7 s), whereas before
the fallback (blurred tile whale) was the only thing on screen until ~1.0–1.2 s.
Caveat: before-runs were recorded at load avg 26–46, after-runs at 9–16; absolute ms shift with
machine load, the structural order above was stable. A later before-code rerun failed WebGL context
creation after many hot reloads (devtools simulator flakiness) — the valid before runs are used.

## Jank / warnings

- 8 fps `draw()+toDataURL()` loop: toDataURL 4–8 ms per frame in the after component, no long-task
  warnings, no exceptions, no dropped-frame evidence in 3×4.6 s runs.
- Copy now emits only one unrelated pre-existing warning (privacy-sheet `theme` property null);
  **no WXML/WXSS compile warnings or errors** from `components/ocean-background/*` or
  `assets/ocean/whale-dots.svg`. All new CSS (data-URI JPEG, data-URI SVG, mask, blend) is accepted
  and reflected in computed styles.
