# Holographic Prism Enclosure — Support-Free V2

This revision replaces the first enclosure. Every printable STL is exported in
its final bed orientation and is designed to print with **supports disabled**.
There are no inverted lids, downward mounting pegs, horizontal snap ledges, or
floating roofs.

## Files to print

- `exports/01_support_free_base.stl` — electronics base, OLED pillars, ESP32
  cradle, rear USB-C arch, and two frame snap tabs.
- `exports/02_support_free_optical_frame.stl` — flat-backed snap-in top frame
  and 30 mm prism seat. Print exactly as imported, collar upward.
- `exports/03_prism_fit_ring.stl` — quick 30.30 mm pocket test. Print this first.
- `validation/support_free_v2_X2D_sliced.3mf` — all three parts arranged and
  sliced for Bambu Lab X2D, 0.4 mm nozzle, 0.20 mm layer height, supports off.

Matching editable STEP files are in `exports/`.

## Key dimensions

| Item | Nominal design value |
|---|---:|
| Base body | 48.0 × 63.0 × 36.5 mm |
| Maximum base height including snap tabs | 40.3 mm |
| Optical frame | 42.9 × 57.9 × 6.5 mm |
| Cube | 30.0 × 30.0 × 30.0 mm |
| Cube pocket | 30.3 × 30.3 mm |
| Cube clearance | 0.15 mm per side |
| OLED PCB envelope | 34.0 × 47.0 × 1.2 mm |
| OLED locating pegs / holes | Ø1.90 / Ø2.20 mm |
| OLED radial clearance | 0.15 mm |
| Optical frame/base clearance | 0.15 mm per side |
| Female Dupont housing length allowance | 14.0 mm |
| Empty height below the OLED Dupont housing | 17.0 mm |
| Empty height between that housing and ESP envelope | 11.7 mm |
| OLED face to optical frame | 0.7 mm |
| OLED face to cube | 1.3 mm |
| Rear USB-C opening | 12.0 mm wide, 49.4° pitched roof |

The 0.15 mm values are per mating side, giving 0.30 mm total diametral or
width clearance across each fit.

The 14 mm Dupont housing envelope comes from the Harwin M20 2.54 mm female
crimp-housing drawing. The wiring volume is intentionally taller than that
housing and opens into two side routing gutters so the cable bundle can turn
gradually rather than folding directly against the connector.

## Print settings

- Print all STLs exactly as supplied; do not rotate the base or frame.
- Supports: **off**.
- Layer height: 0.20 mm.
- Nozzle: 0.4 mm.
- Walls: 3 recommended for durable snap tabs.
- Infill: 15–20% is sufficient.
- PLA/PLA Matte works. PETG will make the two large frame tabs more tolerant of
  repeated removal.
- Allow the bed to cool before removing the tall base.

The geometry report records one manifold solid per part, Z=0 bed contact, and
zero downward STL triangles above the bed that exceed a 45° support limit. The
X2D slice result reports `enable_support = 0` and a successful return code.

## Assembly

1. Print `03_prism_fit_ring.stl` first and confirm that the cube enters without
   force. Never snap or clamp the optical cube itself.
2. Feed the USB-C cable through the rear arch and plug it into the ESP32-C3
   Super Mini. The connector points toward the back of the finished enclosure.
3. Place the ESP board rear/USB end against the two rear stops, then press its
   front antenna edge past the central flexible catch.
4. Connect the female-to-female Dupont leads before installing the OLED. Route
   the leads down the left and right open gutters; do not fold them immediately
   under either connector.
5. Align the four OLED holes over the Ø2.00 mm pegs and press evenly at all four
   corners until the small tapered beads pass the PCB.
6. Lower the optical frame, collar upward, onto the four corner towers. Press
   near the middle of the left and right edges until both wall tabs click into
   the open-top side notches.
7. Place the beam-splitter cube in the 30.30 mm seat last.

## Fit warning

The CAD uses the published/identified module envelopes and the requested 0.15
mm per-side fit. Low-cost ESP32 and OLED boards can vary between suppliers, and
printer flow calibration changes real snap interference. Test the prism ring
and dry-fit the electronics before committing to a complete cosmetic print.

## Validation and regeneration

- `validation/geometry_validation.json` — dimensions, clearances, manifold and
  support-angle checks.
- `validation/x2d_slice_result.json` — Bambu Studio X2D slice result.
- `validation/plate_1_0.png` — arranged plate preview.
- `generate_support_free_v2.py` — complete parametric CadQuery source.

Regenerate CAD with:

```sh
./.venv-hologram-cad/bin/python \
  Holographic_Prism_Enclosure/support_free_v2/generate_support_free_v2.py
```

References:

- Harwin M20 female housing dimensional source: <https://www.harwin.com/products/M20-1060900>
- Pololu 2.54 mm, 26 AWG female-to-female jumper-wire specification: <https://www.pololu.com/product/1715/specs>
