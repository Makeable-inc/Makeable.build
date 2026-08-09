# ESP32 CYD E32R28T Soil Monitor Case

Fusion 360 enclosure built around the official LCDWiki/QDtech E32R28T STEP
model and its 2024-08-31 mechanical drawing.

## Verified board geometry

- PCB: 86.00 x 50.00 mm
- Imported STEP extents: 86.41 x 50.06 x 10.37 mm
- Mounting holes: 4 x 3.20 mm on a 78.00 x 42.00 mm pattern
- LCD active area: 57.60 x 43.20 mm
- Active-area position in landscape: X = 17.10 mm, Y = 3.40 mm from
  the PCB datum
- LCD glass outline: 69.20 x 50.00 mm
- Resistive-touch outline: 68.80 x 49.60 mm

## Enclosure geometry

- Overall footprint: 92.00 x 56.00 mm
- Corner radius: 4.00 mm
- Front bezel: 2.40 mm thick
- Pixel-aligned opening: 57.60 x 43.20 mm
- Touch-panel relief: 68.80 x 49.60 mm with a 0.40 mm retaining lip
- Rear shell depth: 16.00 mm
- Wall/back thickness: 2.40 mm
- PCB bosses: 6.50 mm OD with 2.70 mm M3 pilot holes
- USB-C side opening: 16.00 x 8.00 mm
- Soil-sensor cable pass-through: 8.00 mm on the rear panel
- Five rear ventilation slots

## Files

- `assets/E32R28T_3D.step`: official manufacturer board model
- `assets/E32R28T_Size.pdf`: official manufacturer mechanical drawing
- `exports/ESP32_CYD_Soil_Monitor_Case.f3d`: editable Fusion archive
- `exports/ESP32_CYD_Case_Assembly.step`: complete case and board assembly
- `exports/ESP32_CYD_Front_Bezel.step`: front case component
- `exports/ESP32_CYD_Rear_Shell.step`: rear case component
- `exports/ESP32_CYD_Front_Bezel.stl`: high-resolution print mesh
- `exports/ESP32_CYD_Rear_Shell.stl`: high-resolution print mesh

## Retro housing concept art

- `concepts/retro-cyd-three-concepts.png`: three exploded housing directions
- `concepts/mini-terminal-exploded-handoff.png`: detailed Mini Terminal assembly
- `concepts/CONCEPT_NOTES.md`: prompt summary and CAD translation notes

## Concept B Bubble Monitor — screwless prototype

The selected Bubble Monitor direction is now a three-part, screwless Fusion
assembly around the actual manufacturer E32R28T STEP:

- separate pillowed front faceplate;
- hollow rounded rear shell with four serviceable cantilever latches;
- slide-on press-fit foot with twin dovetail rails.

The PCB is located on four 2.55 mm pins through its published 3.20 mm holes.
Four front support faces and four hollow rear pads support the board only around
those holes; closing the shell captures the board with approximately 0.20 mm of
total axial allowance.  No printed clip bears on an electronic component.

The visible opening is 57.70 x 43.30 mm and is centred on the verified
57.60 x 43.20 mm illuminated area.  A 0.20 mm-deep straight front mask holds
that dimension at the physical surface before opening into the lofted bevel.
The larger 69.80 x 50.60 mm rear pocket clears the display glass by 0.30 mm per
side while the mask and bevel hide the black glass border.

Concept B deliverables are in `exports/concept_b/`:

- `CYD_ConceptB_Bubble_Monitor.f3d`: editable Fusion assembly;
- `CYD_ConceptB_Assembly_With_Board.step`: case plus actual CYD board;
- three individual STEP files;
- three watertight, high-resolution STL files;
- `CYD_ConceptB_validation.json`: fit values and automated checks.

See `CONCEPT_B_BUILD_NOTES.md` for print orientation, assembly, and first-fit
tuning.

## Print-fit note

The aperture follows the nominal LCD active area exactly so the surrounding
black display border is covered. Print a short bezel test or verify your
printer's XY calibration before the full case: the manufacturer specifies
unmarked dimensions at +/-0.20 mm, and printer/material shrinkage can add
another small offset.

## Claude Burner Tamagotchi

The CYD now also has a complete Claude Burner desktop companion and display
firmware:

- `claude-burner-desktop/`: Apple Silicon macOS 13+ Electron app and unsigned
  DMG build;
- `firmware/claude-burner-cyd/`: ILI9341/CH340C display firmware and PlatformIO
  flash scripts;
- `ember_growth_visuals/final-v1/frame_folders_320x240_25fps/`: one 25 FPS,
  320x240 frame folder for every growth/emotion state and the offline scene.

See `claude-burner-desktop/README.md` for installation, privacy, LIFE rules,
and developer commands.
