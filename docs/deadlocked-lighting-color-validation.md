# Deadlocked Lighting and Color Modulation Validation

Status: 2026-08-30

This document records the end-to-end investigation into muted or washed-out
lighting in Mapomatic, using Deadlocked level 44 and TIE class `0x2232` as the
primary reference. It is intended to prevent future sessions from repeating
the same experiments or reintroducing disproven global color corrections.

## Executive summary

The main crater discrepancy was not caused by texture resolution, final scene
grading, alpha, or near fog. Mapomatic was missing part of Deadlocked's
per-source TIE lighting pipeline:

1. Decode the compact instance-lighting cache with PEXT5 low-bit replication.
2. Apply the selected level directional lights to each source normal.
3. If normal-table mode bit 0 is set, multiply each lit source by its own scale
   byte and divide by 128.
4. Apply the RGBA copy/average recipes to produce the final per-vertex lighting
   bytes.
5. Modulate texture bytes by those lighting bytes using the GS `/128` scale.
6. Apply near/far fog and the normal display conversion.

For crater class `0x2232`, the normal table has mode bit 0 set and contains 82
source records. Every source scale byte is `81`, so the retail renderer applies
`floor(litSource * 81 / 128)` before the 421 output recipes. Applying a broad
darkening factor after the recipes was therefore structurally wrong and
darkened unrelated TIE classes.

The implemented Mapomatic path was replayed against the slot-1 retail
framebuffer data for all 421 crater targets. Its maximum error is one byte in
any RGB channel, with an MSE of approximately `0.20`. With directional lights
zeroed, the compact decode, scale, and remap stages match all 246 compared
source bytes exactly.

Do not add a global saturation, gamma, fog, or TIE-darkening correction for
this issue. If a future comparison is still wrong, first verify that the asset
was re-exported with the packed-light metadata and that the current CLI, WASM,
and Mapomatic bundles were republished.

## Reference scene and assets

- Game: Ratchet: Deadlocked, US retail, `SCUS-97465`.
- Level: 44.
- Primary TIE class: `0x2232` (`8754` decimal), the large crater.
- Mapomatic screenshots in the investigation used the left half for Mapomatic
  and the right half for the game.
- Red specks in some game screenshots were a weather effect and were excluded
  from the investigation.
- The user forced the game's high-resolution texture by zooming in. The green
  and contrast discrepancy remained, ruling out a simple LOD-texture mismatch.

Primary extraction:

```text
/run/media/system/data/Projects/ratchet-ps2-cli/test-assets/extractions/level44_iso_world01
```

Important extracted files:

```text
assets/tie/08754_2232/tie.bin
assets/tie/08754_2232/tie.gltf
world/tie/instances.bin
world/tie/colors.bin
world/tie/groups.bin
world/lighting/directional_lights.bin
```

The five crater instances are instance indices 289 through 293. Instance 292
was the primary controlled sample because the slot-1 camera looked directly at
it.

User-created PCSX2 slot-1 save state:

```text
/var/home/connor/.config/PCSX2/sstates/SCUS-97465 (9BFBCD42).01.p2s
```

The save state was extracted during this investigation to:

```text
/tmp/level44-slot1-220845
```

Anything under `/tmp` is a transient forensic artifact and may not survive a
reboot. The formulas and conclusions needed to reproduce the work are recorded
below.

## PCSX2 and debugging setup

The tested PCSX2 AppImage was version `2.7.308`. Its mounted binary during the
session was:

```text
/tmp/.mount_pcsx2-hPHHmC/usr/bin/pcsx2-qt
```

This build does not support `-cfgpath`; passing it produces:

```text
Unknown parameter: '-cfgpath'
```

Use environment isolation instead:

```bash
XDG_CONFIG_HOME=/tmp/pcsx2-audit \
XDG_RUNTIME_DIR=/tmp/pcsx2-runtime \
QT_QPA_PLATFORM=xcb \
DISPLAY=:0 \
/path/to/pcsx2-qt
```

The isolated PCSX2 configuration was stored in:

```text
/tmp/pcsx2-audit/PCSX2
```

The PINE helper used for live EE-memory reads and controlled lighting edits was:

```text
/tmp/pcsx2-audit/pine.mjs
```

It acquired helper modes named `tie`, `light`, `record`, `invalidate`,
`zero-light`, and `restore-light`. The original level-light words were restored
after the controlled zero-light experiment, and the emulator was left paused.

## Confirmed retail pipeline

### 1. Compact TIE cache decoding

Each instance's color-cache entry begins with two 16-bit header words followed
by packed RGB5 source words.

```text
baseR = header0 & 0xff
baseG = (header0 >> 8) & 0xff
baseB = header1 & 0xff
shift = ((header1 >> 8) & 0xff) & 0x3f
```

Deadlocked expands each 5-bit channel with PEXT5 before applying the shift:

```text
PEXT5(value) = (value << 3) | (value >> 2)
channel = clampByte(base + (PEXT5(packed5) >> shift))
```

Mapomatic previously used only `value << 3`, losing the replicated low bits.
The fix is in:

```text
src/services/mapPackages/tiePackageParsers.ts
```

Source color indices begin at cache word 2. The packed-normal/scaling metadata
arrays use index `sourceIndex - 2`.

### 2. Packed source normals and instance rotation

Each Deadlocked TIE normal-table source record is eight bytes:

```text
+0  X
+1  Y
+2  Z
+3  W
+4  unknown
+5  lighting scale byte
+6  packed normal low byte
+7  packed normal high byte
```

The two packed-normal bytes encode azimuth and elevation:

```text
azimuth   = lowByte  * 2*pi / 256
elevation = highByte * 2*pi / 256

normal = [
  -cos(azimuth) * cos(elevation),
  -sin(azimuth) * cos(elevation),
  -sin(elevation)
]
```

Retail removes instance scale before evaluating the source normal. It
normalizes the three instance-matrix basis rows, then uses the transposed
rotation for the packed normal. This was important for instance 292 because its
third raw basis row has length approximately `0.5862207`.

The analyzed runtime transform for instance 292 was approximately:

```text
row0 = [ 0.912289, -0.409547, 0, 1 ]
row1 = [ 0.409547,  0.912289, 0, 1 ]
row2 = [ 0,         0,        0.586221, 1.705842 ]
```

Multiplying each row's XYZ by its W component removes the scale; for row 2,
`0.5862207 * 1.705842` is approximately 1.

The implemented transform and packed-normal decode are in:

```text
src/features/map-viewer/renderer/ties/TieLighting.ts
```

### 3. Directional-light selection and contribution

The TIE instance light selector uses:

```text
primary slot   = selector & 0x0f
secondary slot = (selector >> 4) & 0x0f
blend byte     = (selector >> 8) & 0xff
blend amount   = blendByte / 256
```

When the blend byte is zero, only the primary record is evaluated. Otherwise,
the top/inverse colors and directions are linearly blended before evaluation.

For both top and inverse lights, the confirmed CPU formula is equivalent to:

```text
rawDot = dot(normal, normalize(direction))
dotTerm = max(rawDot, rawDot * colorAlpha)

contribution = max(0,
  topColor.rgb     * topDotTerm +
  inverseColor.rgb * inverseDotTerm)
```

The best match to the retail VU output converts that contribution to cache-byte
units with a multiplier of 127 and truncates downward before adding it to the
compact source color:

```text
litSource = clampByte(baseSource + floor(contribution * 127))
```

This is shared with the confirmed TFRAG directional-light evaluation through:

```text
src/features/map-viewer/renderer/TfragMaterialState.ts
```

The retail VU microprogram still differs by at most one byte for some source
channels. Using 128 instead of 127 produces a worse aggregate fit. That final
one-byte discrepancy is documented under "Remaining uncertainty" rather than
being hidden behind a scene-wide correction.

### 4. Per-source scale and normal-table mode bit

For Deadlocked's normal-table format, a 32-bit mode value exists at normal-table
offset `+4`. `LightTies` checks bit 0. When it is set, retail applies the scale
byte at source-record offset `+5` after directional lighting and before output
recipes:

```text
scaledSource = floor(litSource * scaleByte / 128)
```

Crater `0x2232` has:

```text
PackedLightModeBits = 1
PackedLightNormals  = 82 entries
PackedLightScales   = 82 entries
unique scale values = [81]
```

This was the principal missing operation behind the crater's washed-out
appearance. It is source/class-specific, which explains why replacing it with
a global TIE darkening factor regressed other levels.

The CLI now reads and exports these fields in both runtime-only and full glTF
metadata. The relevant source files are in the sibling CLI repository:

```text
/run/media/system/data/Projects/ratchet-ps2-cli/src/RatchetPs2.Core/Ties/TieClass.cs
/run/media/system/data/Projects/ratchet-ps2-cli/src/RatchetPs2.Core/Ties/Binary/TieClassReader.cs
/run/media/system/data/Projects/ratchet-ps2-cli/src/RatchetPs2.Core/Ties/Binary/TieVertexNormalReader.cs
/run/media/system/data/Projects/ratchet-ps2-cli/src/RatchetPs2.Core/Ties/Gltf/TieGltfDocumentBuilder.cs
```

### 5. RGBA remap recipes

Retail lights and scales the source colors first, then applies direct-copy and
averaging recipes to generate target colors. Mapomatic must not apply
directional light to already-remapped output colors because that changes both
the normals and integer rounding points.

For each output recipe and RGB channel:

```text
target = floor(sum(sourceColors) / divisor)
```

Crater `0x2232` exports 421 recipes. Mapomatic applies them while building its
per-instance ambient texture in:

```text
src/features/map-viewer/renderer/ties/TieAmbient.ts
```

The ambient binding records whether directional lighting is already baked. The
material shader only uses its older per-vertex directional fallback for legacy
packages that do not contain packed-light metadata. This prevents applying the
same directional light twice.

### 6. GS texture modulation

The GS draw uses `TFX_MODULATE` with the neutral vertex-lighting alpha/scale of
128. Byte-accurate RGB modulation is:

```text
outputByte = floor(textureByte * lightingByte / 128)
```

Mapomatic performs the multiply in display-byte space and decodes the result
back to its linear render representation in:

```text
src/features/map-viewer/renderer/ModelFog.ts
```

The investigation also restored each texture's source minification,
magnification, mipmap, and anisotropy settings. Forcing linear sampling with no
mipmaps made the textures pixelated but did not improve color modulation.
`configureModelDisplayTexture` should only mark PS2 color textures as
`THREE.NoColorSpace` and leave the source sampler intact.

### 7. Near/far fog

Strong near fog does affect TIE and TFRAG coloring, so it was a valid lead, but
it was not the missing crater operation.

Deadlocked's fog intensity byte is a residual amount with a 256 denominator:

```text
fogAmount = (256 - F) / 256
```

For level 44:

```text
fog color    = [40, 50, 40]
near distance = 61440
far distance  = 179200
near F         = 255
near amount    = 1/256
```

Fog and lighting terms are interpolated without perspective correction in the
retail path. The Mapomatic TIE, TFRAG, and fog nodes now use vertex-stage linear
interpolation for those values.

### 8. Final display and post-processing

The following were explicitly checked:

- PCSX2 Shade Boost was disabled.
- Replaying the game's final post-processing chain changed the central crater
  sample by zero bytes.
- The final game copy step was effectively neutral, approximately `-0.3` byte
  on average.
- Mapomatic's Three.js output conversion occurs once.
- PS2 textures marked `NoColorSpace`, followed by explicit display-byte math
  and the final renderer conversion, do not show an obvious double-gamma path.

No final scene saturation, gamma, contrast, or lift correction was justified by
the evidence.

## TFRAG findings

The user correctly noted that the TFRAG terrain was also not fully accurate.
That helped confirm that directional-light and GS modulation logic needed to be
validated across both geometry families rather than treating the crater as a
texture-only problem.

Confirmed TFRAG behavior:

- Its RGB5 cache base uses `rgb5 / 16` in the normalized `/128` vertex-lighting
  representation.
- PEXT5 low-bit replication is correct for the compact TIE cache, but applying
  it to TFRAG RGB5 was a regression.
- Directional-light contribution is added to the decoded RGB5 base before GS
  texture modulation.
- Top and inverse directional vectors are both used.
- The decoded TFRAG normal sign is correct.
- TFRAG light terms use non-perspective interpolation.
- GS texture modulation uses the same byte-accurate `/128` rule as TIEs.

The current TFRAG implementation is primarily in:

```text
src/features/map-viewer/renderer/TfragMaterialController.ts
src/features/map-viewer/renderer/TfragMaterialState.ts
```

If a future TFRAG comparison remains slightly wrong, investigate VU/cache
quantization and per-output scaling before adding any global scene color grade.

## Retail function references

The loaded US retail executable was analyzed in Ghidra. Relevant named
functions and addresses are:

```text
SetupTfragTieShrubLighting @ 0x004ee8f8
LightTfrags               @ 0x00591d00
ResetTieLightingCache     @ 0x00592a60
LightTies                 @ 0x00596780
```

The `LightTies` mode-bit check and per-source `/128` scale operation occur in
the approximate EE instruction range:

```text
0x005972b4 .. 0x0059741c
```

The local Ghidra MCP HTTP service used during the session was read-only at:

```text
http://127.0.0.1:8080
```

Useful endpoints included:

```text
/searchFunctions
/get_function_by_address
/decompile_function
/disassemble_function
/xrefs_to
```

No Ghidra database mutations were made.

The active VU0 microprogram was present in the extracted save-state
`vu0MicroMem.bin`. `LightTies` calls VU addresses `0x58` and `0x84`,
corresponding to VU micro-memory byte offsets `0x2c0` and `0x420`. The VU
pipeline is the likely source of the remaining occasional one-byte rounding
difference.

## GS dump and framebuffer references

PCSX2 screenshot and GS dump captured during the investigation:

```text
/tmp/pcsx2-audit/PCSX2/snaps/Ratchet - Deadlocked_SCUS-97465_20260829222659.png
/tmp/pcsx2-audit/PCSX2/snaps/Ratchet - Deadlocked_SCUS-97465_20260829222701.gs.zst
/tmp/pcsx2-audit/crater.gs
```

The candidate crater draw group covered GS events 1945 through 2036 and
contained:

```text
507 vertices
227 triangles
TFX_MODULATE
vertex alpha = 128
fog F = 255
```

Observed GS vertex RGB statistics for the crater group:

```text
mean = [62.2406, 65.0138, 53.3609]
min  = [44, 46, 38]
max  = [82, 86, 71]
```

Save-state/live addresses used during the controlled experiment included:

```text
instance 292 record          0x015cce00
instance 292 compact colors  0x015f1b44
live output ring base        0x00870000
saved-frame output table     around 0x00880388
instance transform table ptr 0x00223110 -> 0x015d22c0
```

These are frame/build-specific diagnostic addresses, not stable file-format
offsets. The output table starts with target index 2; it is the post-recipe
target table, not the compact source table.

## Validation results

### Extraction completeness

For crater `0x2232`:

- All TIE instance, cache, and geometry mappings needed by the renderer were
  present.
- Textures and palettes matched the extracted game assets.
- The crater draw is opaque; alpha blending was not washing out its color.
- The fresh CLI export reported 82 packed normals, 82 scales, mode bits 1, 84
  ambient words, 433 ambient slots, and 421 color recipes.

### Zero-direction controlled experiment

Directional light records were temporarily zeroed, the instance lighting cache
was invalidated, and retail TIE lighting was allowed to rebuild. The original
light words were restored afterward.

Prediction:

```text
PEXT5 compact decode
-> floor(source * 81 / 128)
-> exact integer recipe remap
```

Result:

```text
exact bytes compared = 246 / 246
minimum difference   = 0
maximum difference   = 0
```

This is direct proof of both the crater's scale byte and the required operation
order.

### Directional-light fit

Using the retail level-44 directional-light record, the packed normal formula,
rotation-only instance basis, multiplier 127, and truncation produced:

```text
source RGB triplets exactly equal = 43 / 82
MSE                               = 0.191
maximum channel error             = 1 byte
```

Multiplier 128 and the tested alternative matrix/sign combinations produced a
worse fit.

### Full Mapomatic target replay

The implemented `applyTieSourceLighting` path was replayed against slot 1 for
all crater output recipes:

```text
exact target RGB triplets = 207 / 421
target MSE                = 0.201108...
maximum channel error     = 1 byte
```

The remaining error is below the threshold that could explain the original
washed-out screenshot. It should not be compensated with a global color
adjustment.

## Implemented source paths

### Mapomatic

```text
src/services/mapPackages/tiePackageParsers.ts
  PEXT5 compact TIE cache decoding.

src/features/map-viewer/renderer/ties/TieTypes.ts
src/features/map-viewer/renderer/ties/TieClassSource.ts
src/features/map-viewer/renderer/ties/TiePrimitiveMerge.ts
  Packed-light metadata types, glTF parsing, and merge compatibility.

src/features/map-viewer/renderer/ties/TieInstanceController.ts
  Supplies raw level directional-light records to the CPU ambient bake.

src/features/map-viewer/renderer/ties/TieLighting.ts
  Packed-normal decode, rotation-only transform, directional-light evaluation,
  and per-source scaling.

src/features/map-viewer/renderer/ties/TieAmbient.ts
  Per-instance source lighting followed by exact integer recipe remapping.

src/features/map-viewer/renderer/ties/TieMaterials.ts
  Avoids applying shader directional lighting again when it is CPU-baked.

src/features/map-viewer/renderer/TfragMaterialController.ts
src/features/map-viewer/renderer/TfragMaterialState.ts
  Shared directional-light formula and correct TFRAG RGB5 `/16` cache scale.

src/features/map-viewer/renderer/ModelFog.ts
src/features/map-viewer/renderer/MapSceneRenderer.ts
  Byte-accurate texture modulation, source sampler preservation, fog residual,
  and non-perspective fog interpolation.
```

Focused tests:

```text
tests/tieAmbient.test.ts
tests/tfragAtlas.test.ts
tests/tieClassSource.test.ts
```

### Ratchet PS2 CLI

```text
src/RatchetPs2.Core/Ties/TieClass.cs
src/RatchetPs2.Core/Ties/Binary/TieClassReader.cs
src/RatchetPs2.Core/Ties/Binary/TieVertexNormalReader.cs
src/RatchetPs2.Core/Ties/Gltf/TieGltfDocumentBuilder.cs
tests/RatchetPs2.TieTests/Program.cs
```

The CLI emits these glTF mesh extras:

```text
PackedLightModeBits
PackedLightNormals
PackedLightScales
```

They are emitted in both `RuntimeOnly` and `Full` metadata modes.

## Disproven or incomplete approaches

Do not repeat these as first-line fixes:

- Global TIE darkening: made the crater darker but incorrectly darkened TIEs
  on other levels.
- Global saturation/contrast/gamma/lift: the retail framebuffer evidence points
  to missing per-source operations, not a final grade.
- Treating near fog as the sole cause: near fog affects color, but level 44's
  `F=255` near amount is only `1/256`, and correcting it did not fix the crater.
- Texture LOD/resolution: forcing the game's high-resolution texture did not
  remove the discrepancy.
- Forcing linear sampling and disabling mipmaps: caused pixelation without
  improving modulation.
- Applying directional light in the shader after recipe remapping: uses the
  wrong normals and integer rounding order.
- Applying TIE PEXT5 expansion to TFRAG RGB5: TFRAG uses `rgb5 / 16`.
- Alpha/blending: the crater's relevant draw is opaque.
- Weather specks: unrelated visual effect.
- PCSX2 post-processing or Shade Boost: neither explains the mismatch.
- Double-gamma/final output conversion: no extra conversion was found in the
  tested Mapomatic output chain.

## Build, cache cleanup, and publish procedure

The development viewer selects current outputs by timestamp. Source changes are
not enough; republish the Linux CLI, Release WASM package, and Mapomatic build.

From the CLI repository:

```bash
dotnet build build.proj -t:CleanArtifacts

dotnet build src/RatchetPs2.Cli/RatchetPs2.Cli.csproj \
  -t:Clean -p:Configuration=Release

dotnet build src/RatchetPs2.Wasm/RatchetPs2.Wasm.csproj \
  -t:Clean -p:Configuration=Release

dotnet build src/RatchetPs2.Cli/RatchetPs2.Cli.csproj \
  -t:Publish \
  -p:Configuration=Release \
  -p:RuntimeIdentifier=linux-x64 \
  -p:SelfContained=false \
  -p:PublishDir=/run/media/system/data/Projects/ratchet-ps2-cli/artifacts/publish/ratchet-ps2-linux-x64/

dotnet build src/RatchetPs2.Wasm/RatchetPs2.Wasm.csproj \
  -t:Publish \
  -p:Configuration=Release \
  -p:PublishDir=/run/media/system/data/Projects/ratchet-ps2-cli/artifacts/ratchetps2-wasm-publish/
```

The Release WASM project uses AOT and `-O3`; it took approximately two minutes
on the investigation machine.

From the Mapomatic repository, replace the generated WASM bundle instead of
overlaying it and leaving stale hashed assemblies:

```bash
rsync -a --delete \
  /run/media/system/data/Projects/ratchet-ps2-cli/artifacts/ratchetps2-wasm-publish/package/ \
  public/ratchetps2/

rsync -a --delete \
  --include='ratchetps2-wasm.js' \
  --include='ratchetps2-wasm.d.ts' \
  --exclude='*' \
  /run/media/system/data/Projects/ratchet-ps2-cli/artifacts/ratchetps2-wasm-publish/package/ \
  src/vendor/ratchetps2-wasm/

npm run build
```

The generated WASM cache is reproducible from the CLI publish directory. During
the completed publish, the source package, `public/ratchetps2`, and `dist`
copies of the hashed `RatchetPs2.Core` WASM had identical SHA-256 hashes.

## Tests and known unrelated failures

Completed Mapomatic verification:

```bash
npm run typecheck
npm test
npm run build
```

Result:

```text
TypeScript checks: pass
Mapomatic tests:   21 / 21 pass
Production build: pass
```

The published Linux CLI was also used to export crater `0x2232`; the resulting
glTF passed checks for mode 1, 82 normals, 82 scales, and scale value 81.

The CLI's broad `RatchetPs2.TieTests` executable still reports ten unrelated,
pre-existing normal/winding/remap assertions even though the new packed-light
reader/export assertions pass. The failures recorded in this session were:

1. Main fixture source-normal 42 remap to packet 0 row 29.
2. DL 8314 duplicate-position welded-normal dot.
3. DL 8802 weak authored top-band normals.
4. DL 9038 expected mostly inverted accepted source normals.
5. DL 9468 low-bit flagged normal-table target.
6. DL 9468 expected excessive downward source normals.
7. DL 9468 outer-side tilted triangle.
8. DL 9468 outer-side vertical flattening.
9. DL 9324 duplicate-position welded-normal dot.
10. DL 9786 dense logical normal-remap chunks.

Do not conflate those geometry-normal fixture failures with the packed-light
metadata and crater-color validation.

## Remaining uncertainty

- The exact VU floating-point scheduling/quantization responsible for the
  occasional one-byte directional-light difference has not been fully decoded.
  The active VU microprogram is the next place to investigate if byte-perfect
  output becomes necessary.
- The new pipeline was proven against level-44 crater data and the shared retail
  functions. Visual regression comparisons should still cover several TIE
  classes and levels, especially classes with mode bit 0 clear or nonuniform
  source scales.
- Older extracted packages without `PackedLightModeBits`,
  `PackedLightNormals`, and `PackedLightScales` use the legacy shader fallback
  and cannot reproduce the exact source-order pipeline. Re-export them before
  evaluating color accuracy.
- Any remaining scene-wide TFRAG mismatch should be measured directly against a
  GS/framebuffer capture before changing final scene color.

## Future-session checklist

1. Confirm the test package's TIE glTF contains the three packed-light extras.
2. Confirm the CLI binary, WASM bundle, and Mapomatic build timestamps/hashes
   come from the current source.
3. Preserve the operation order: compact decode, directionals, source scale,
   recipes, GS modulation, fog.
4. Compare raw lighting/output bytes before judging screenshots with different
   cameras, weather, HUD overlays, or texture LOD.
5. Do not add global color correction unless both TIE and TFRAG byte-accurate
   pipelines match retail and a measured final-frame transform is still absent.
6. If PCSX2 rejects `-cfgpath`, use `XDG_CONFIG_HOME`; do not spend another
   session debugging that unsupported parameter.
