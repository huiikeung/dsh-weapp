# Whale-dot layer verification

Verification artifacts for the home ocean background whale layer
`miniprogram/assets/ocean/whale-dots.svg` (14,850 bytes).

## Regenerate

    node scripts/generate-ocean-whale-asset.cjs          # rebuild the shipped SVG (round dots)
    node scripts/generate-ocean-whale-asset.cjs --check  # CI: fail if the SVG is stale
    node scripts/generate-ocean-whale-asset.cjs --variant=square \
      --out=preview/whale-asset/whale-dots-square.svg    # butt-capped comparison variant
    node preview/whale-asset/shoot.cjs                   # re-render every PNG in this folder

`shoot.cjs` needs Google Chrome and the native reference screenshot at
`/tmp/dsh-mobile-ref/Design/harness-background-simulator-v2.png`
(re-clone https://github.com/Clarklevis1995/dsh-mobile if missing). It uses
`cdp-shot.cjs` for `Emulation.setDeviceMetricsOverride`, because headless
Chrome CLI enforces a ~500 CSS px minimum window and therefore breaks
`115vw` geometry at 390x844.

## What the layers are

`index.html` stacks the *shipping* ocean shader (regenerated from
`miniprogram/utils/ocean-renderer.js` into `shader.js` on every shot) under the
whale SVG, using the component exact CSS: `left:55%; top:34%;
width/height:115vw; translate(-50%,-50%); opacity:.56; mix-blend-mode:screen`.

| file | what it shows |
| --- | --- |
| `native-vs-asset-full.png` | native dsh-mobile screenshot vs this build, both 402x874 pt @3x |
| `dots-native-square-round.png` | 1:1 device-pixel crops, 2x nearest-neighbour: native reference / butt-capped square dots / shipped round dots, head+body and tail |
| `layer-390x844.png` | shipped stack at 390x844 CSS px, DPR 3 |
| `layer-square-390x844.png` | square-dot variant, same stack |
| `layer-402x874.png`, `layer-square-402x874.png` | same at the reference 402x874 pt geometry (pixel-aligned with the native PNG) |
| `whale-only-390x844.png` | shipping whale over a plain navy gradient |
| `asset-390x844.png`, `asset-square-390x844.png` | dots only, no screen blending: pure sharpness check |

## Measured against the native reference (402x874 pt @3x)

Lattice (rederived from `ocean-particles.js` and the native geometry) matches
the screenshot to sub-pixel: dot row/column spacing 23.1 device px
(= whale square / 60) in both, and per-dot centroid offsets are
< 0.8 device px.

Dot profile in the dark head/body band (85-87 dots):

| | FWHM | median peak above local background |
| --- | --- | --- |
| native reference (blurred 0.18 pt, 18% rounded rect) | 8.0 px | 46.1 |
| butt-capped square variant (15,501 B) | 8.0 px | 50.1 |
| shipped round variant (14,850 B) | 8.0 px | 50.2 |

Round dots keep the native dot footprint (same FWHM) with a silhouette that is
only ~9% brighter at the core than the screenshot blurred dot, while the
square variant adds visible corner weight. No size or opacity correction is
needed for the round variant.

## Intrinsic-size hedge

The SVG is `viewBox="0 0 120 120"` with `width="1344" height="1344"`
(390pt * 115% * 3dpr) so a runtime that rasterises an SVG image at its
intrinsic size before scaling still lands at device resolution. Rendering the
`width="120"` and `width="1344"` versions at 390x844 @3x produced byte-identical
screenshots (0 differing pixels), so the attribute changes nothing in Chrome.
