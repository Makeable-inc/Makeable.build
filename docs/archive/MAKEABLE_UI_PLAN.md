# Makeable UI system and implementation plan

## 1. Product promise

Makeable turns an intimidating hardware workflow into a guided, tactile workbook. A beginner should always know three things: what to do now, why it matters, and how to recover if the physical result is different from the plan.

The complete loop is:

`Describe → Scan Parts → Build + Code → Test → Publish`

The interface should feel like a smart friend has laid a personalized build guide across the desk. The visual language is handmade and warm, while the underlying application remains precise enough to compile firmware, talk to a board, inspect real-world evidence, and publish a reproducible project.

## 2. Success criteria

- A first-time user can move from an idea to a named-parts plan without electronics vocabulary.
- Every primary screen has one unmistakable next action.
- The user's photo remains the source of truth for part detection and build guidance.
- Wiring is presented one physical connection at a time.
- Firmware generation and flashing preserve the existing Arduino CLI and Web Serial paths.
- Testing covers both machine-observable evidence and a simple human confirmation.
- Publishing packages the guide, code, parts list, and test outcome.
- The UI remains recognizably Makeable at every state: cream paper, torn edges, tape, doodles, warm color, and friendly copy.

## 3. Reference-image ledger

All eleven supplied references were inspected at their original resolution. They form a continuous state sequence, not eleven unrelated visual directions.

| Reference | Product state | Elements carried into the implementation |
| --- | --- | --- |
| `image-1.jpg` | Empty Scan Parts | Large conversational heading, taped upload sheet, photo privacy note, camera alternative, photography tips |
| `image-2.jpg` | Recognized parts | Numbered photo callouts, colored part labels, editable recognized-parts chips, large confirm action |
| `image-3.jpg` | Feasibility success | Celebratory headline, complete part checklist, central project illustration, “one piece at a time” handoff |
| `image-4.jpg` | Describe | Friend-like prompt, oversized paper input, sketch attachment, example idea scraps, vivid pink CTA |
| `image-5.jpg` | Missing parts | “You have / Still need” comparison, compatible-part explanation, alternate projects, shopping CTA |
| `image-6.jpg` | Wiring instruction | Step counter, exact pin mapping, zoomed detail, why-note, optional motion proof, confirmation CTA |
| `image-7.jpg` | Connect and load | USB connection checklist, board presence, upload progress and safety note |
| `image-8.jpg` | Automatic test | Two-part test tracker, live checklist, bounded hardware pulse, progress and stop control |
| `image-9.jpg` | Manual test | Three illustrated physical actions, explicit expected result, pass/recovery choice |
| `image-10.jpg` | Publish setup | Repository name/privacy, project notes, proof card, and GitHub publishing path |
| `image-11.jpg` | Publish success | Completion celebration, finished-build photo, repository receipt, share/restart actions |

## 4. Experience architecture

### Stage 1 - Describe

The default route is `#capture`. The user types or speaks an idea in ordinary language and can attach a sketch. Three example scraps show the expected level of specificity without turning the page into a template picker.

Required states:

- Empty idea
- Typed idea
- Voice listening and transcript received
- Sketch attached
- Validation when no idea is provided
- Continue to Scan Parts

### Stage 2 - Scan Parts

The route is `#plan`. The user uploads a desk photo or captures one with the camera. Makeable asks the planning model to identify only relevant visible components and returns normalized photo boxes, names, confidence, wiring choices, warnings, and missing parts.

Required states:

- Empty upload with photography guidance
- Camera open/captured
- Photo selected and previewed
- Recognition in progress
- Editable recognized-parts result
- Feasible build
- Missing-parts recovery
- Planning error with retry

### Stage 3 - Build + Load

The route is `#flash`. This is one stage with two explicit modes: Wiring and Connect + load. The wiring mode turns the returned plan into a stepper. The load mode generates ESP32 firmware behind the scenes, compiles it on the hosted backend, and loads it through Web Serial. Source code, compiler settings, and board-target settings are not exposed to the user.

Required states:

- Wiring step N of total
- Why this connection exists
- Previous/next/confirm movement
- Firmware generation
- Automatic ESP32 firmware preparation
- Compile in progress/success/error
- Board connect and flash progress
- Flash success/recovery

### Stage 4 - Test

The route is `#verify`. The automatic check combines serial output with optional camera evidence. The manual check translates the plan's expected behavior into concrete human actions and a clear pass/fix choice.

Required states:

- Serial disconnected/connected/listening
- Camera off/on
- Automatic verification running
- Evidence summary
- Manual instructions
- Passed test
- Troubleshooting recommendation

### Stage 5 - Publish

The route is `#document`. Makeable generates project notes and publishes the README through the GitHub API when credentials are configured. Firmware source and binary downloads are not offered.

Required states:

- Repository form
- Public/private selection
- Package preview
- Publish in progress
- Published receipt and link
- Authentication/configuration error

## 5. Visual system

### Color roles

- Canvas: warm cream, never flat white.
- Ink: soft near-black for headings and drawn lines.
- Primary action: coral-red for physical progress actions.
- Describe: coral/pink.
- Scan Parts: saturated hot pink.
- Build + Code: periwinkle.
- Test: mint.
- Publish: sunflower yellow.
- Notes: pale yellow paper.
- Success: deep mint/green.
- Informational accents: cobalt and violet.

Color is used as wayfinding, not decoration alone. A stage keeps the same color in the rail, active controls, status markers, and related tape.

### Typography

- Headlines use a rounded, chunky display face with compact line-height.
- Body and labels use a legible handwritten/rounded sans style.
- Code uses a true monospace face.
- The scale favors a single oversized question or outcome over multiple competing headers.

### Material and shape

- Main work surfaces are white torn-paper cards over a cream fiber texture.
- Washi tape anchors important cards and changes pattern/color across the flow.
- Buttons are broad paper strips with slight rotation and imperfect edges.
- Doodles-arrows, sparkles, underlines, motion marks-explain attention and causality.
- Shadows stay shallow and diffuse so the UI reads as paper on a desk, not glass floating in space.

### Layout

- A fixed-width left rail preserves the five-step journey.
- The main canvas uses a wide workbook composition close to the supplied 4:3 references.
- Primary headings sit above the working sheet; contextual notes live at the right edge.
- The dominant CTA sits at the lower right or lower center of the current working sheet.
- Only one visually dominant action is allowed per state.

## 6. Component anatomy

### Stage rail

Each item contains a numbered badge, icon, label, stage color, and completion state. A hand-drawn dashed line joins the cards. The current item is saturated; inactive items are muted; complete items gain a green check.

### Work sheet

The shared sheet component provides torn edges, a taped corner, internal padding, and a content slot. It can hold an input, photo, code editor, circuit guide, test monitor, or publishing package without changing the overall page grammar.

### Primary paper button

Large, high-contrast, action-led copy such as “Start my build,” “Name my parts,” or “Load code.” It has a tactile hover lift, pressed state, keyboard focus ring, disabled state, and busy label.

### Sticky note

Short explanations only: privacy, why a connection exists, test safety, or recovery advice. Notes should never contain the primary task.

### Part chip and callout

A callout pairs a sequence number, colored label, and bounding-box anchor. The same sequence/color appears in the chip list below the image. Rename/remove actions must remain keyboard reachable.

### Evidence panel

Serial, camera, and automatic-test output share one status grammar: waiting, active, pass, warning, fail. Raw technical output is available, but the first sentence translates it for beginners.

## 7. Asset strategy

Production assets live in `images/makeable/`.

- `self-watering-kit.png` - generated hero/feature illustration showing the complete build.
- `scan-parts.svg` - upload/camera instruction drawing.
- `plant-doodle.svg` - lightweight idea-state illustration.
- `icon-chat.svg` - Describe stage.
- `icon-camera.svg` - Scan Parts stage.
- `icon-code.svg` - Build + Code stage.
- `icon-bolt.svg` - Test stage.
- `icon-globe.svg` - Publish stage.
- `icon-paperclip.svg` - sketch attachment.

The SVGs provide crisp UI marks and may be recolored by state. The generated PNG provides the hand-rendered feature art that would feel synthetic if drawn entirely with CSS. Source concept art is retained at `design/makeable-ui-concept.png`.

## 8. Backend contract that must not regress

The visual rewrite does not replace the existing behavior. These contracts remain in scope:

- `/api/config` returns public runtime configuration and model names.
- `/api/health` reports API-key and hosted ESP32 compiler readiness without returning secrets.
- OpenAI Responses API calls produce structured project plans, firmware, and verification summaries.
- Deepgram powers browser voice transcription.
- `/api/esp32/status` confirms the hosted compiler and ESP32 core are ready.
- Firmware compilation writes an isolated temporary sketch/build directory.
- Web Serial owns user-approved board connection and flashing.
- Camera capture stays local until the user initiates analysis.
- GitHub API calls create a repository and upload README/firmware when a token is configured.

The selected planning and reasoning model is `gpt-5.6-terra` with `xhigh` reasoning effort. The app keeps model selection in configuration so it can be changed without a UI rewrite.

## 9. Motion and delight

- Active rail cards settle with a tiny rotation and lift.
- Buttons lift on hover and compress on press.
- Stage changes crossfade the work surface rather than moving the entire frame.
- Progress and connection status animate only while work is active.
- Doodle marks can pop in after success, but no continuous decorative animation should compete with wiring or safety instructions.
- Completion uses a brief celebratory treatment, then leaves controls stable and readable.

All motion honors `prefers-reduced-motion`.

## 10. Responsive policy

Makeable is a wide, visual workbench. At desktop and landscape-tablet widths, the rail and work surface remain side by side. At narrow portrait widths, the app intentionally presents a polished “Turn sideways to build” card rather than shrinking circuit labels into an unsafe or unreadable view.

Targets:

- Primary fidelity viewport: 1536 × 1024.
- Supported landscape floor: 1180 × 820.
- Portrait fallback verified at 820 × 1180.
- No document-level horizontal overflow at the primary viewport.

## 11. Accessibility and safety

- Every interactive control uses a native button/input or has equivalent keyboard behavior.
- Focus remains visible against both cream and saturated stage colors.
- Icons never carry meaning without text or an accessible name.
- Status is communicated by copy and symbol, not color alone.
- Form errors appear adjacent to the action that caused them.
- Photo and camera controls explain how imagery is used.
- Flashing and automatic-test steps surface hardware safety notes before activation.
- Reduced-motion users get immediate state changes.
- The manual test provides a troubleshooting path instead of a dead-end failure.

## 12. Fidelity ledger

Direct matches implemented:

1. Five colored paper cards in a persistent left workflow rail.
2. Cream paper canvas, taped torn-white working sheets, and hand-drawn annotation language.
3. Chunky two-line conversational headings with pink underline accents.
4. Stage-specific copy and actions that follow the eleven-image journey.
5. Describe-stage oversized idea sheet, sketch attachment, example scraps, and plant doodle.
6. Scan-stage taped upload area, camera alternative, privacy note, and photo tips.
7. Build-stage wiring/load split with step navigation and one automatic connect-and-load control.
8. Test-stage automatic/manual structure with serial and camera evidence.
9. Publish-stage repository controls, project notes, and a published receipt.

Intentional deviations:

- Deepgram voice controls remain visible on Describe because voice input already exists in the backend and is useful to beginners.
- The implementation supports only the ESP32 family even where the supplied references use other board imagery.
- Shop links and prices from the missing-parts reference are represented as planning/recovery information rather than commerce, because the backend has no purchasing contract.
- Video proof in wiring is represented through the existing photo/camera and guide tools; no video-content service exists in the backend.
- Narrow portrait mode asks the user to rotate the device so pin labels and hardware actions remain safe to read.

## 13. Verification matrix

| Area | Check |
| --- | --- |
| Static quality | JavaScript syntax for browser, Node server, and Netlify function |
| API readiness | `/api/health`, `/api/config`, `/api/esp32/status` |
| Model | Config reports the same best model for planning and reasoning |
| Describe | Input accepts a real idea and Start advances to Scan Parts |
| Scan | Empty-submit validation is clear; image/camera code paths remain wired |
| Build | Stage route loads; Wiring and Connect + load modes switch correctly |
| Test | Stage route loads with serial, camera, and manual verification controls |
| Publish | Stage route loads with repo configuration and package preview |
| Navigation | Hash routes update on stage change and direct deep links restore the correct state |
| Console | No unexpected browser errors or warnings during the golden path |
| Assets | Every `images/makeable/` image is complete and has nonzero dimensions |
| Layout | No horizontal document overflow or clipped primary controls at 1536 × 1024 |
| Responsive | Full workbench at 1180 × 820; intentional fallback at 820 × 1180 |
| Visual QA | Final desktop capture compared side by side with the generated concept and all eleven references |

## 14. Future increments

1. Add user-editable detected bounding boxes and direct rename-on-photo.
2. Create reference-quality diagrams for each generated wiring step from structured pin mappings.
3. Add a safe component sourcing provider for missing-part recommendations.
4. Record optional short wiring clips for common ESP32 modules.
5. Persist a resumable build session so a physical project can span multiple days.
6. Add an automated visual-regression suite around the five stage routes.
7. Validate the full physical loop on a real ESP32, soil sensor, and pump test fixture.
