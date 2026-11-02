# Enclosure generator

Turns a project's parts into a 3D-printable case, on its own. The code is in `enclosure/`. It runs locally and is not connected to the site yet. How the inside is built is in [enclosure-parts-library.md](enclosure-parts-library.md).

## What a customer gets

| Result | What they get |
|---|---|
| PASS | The case model |
| PASS WITH WARNINGS | The case model and a print checklist |
| FAIL | No model, a plain reason, after one automatic retry |

A case reaches the customer only if every must-pass check passed on the exported files. The AI's own claims are never trusted.

## The flow

```text
 Parts + wiring, and a base design (hand-written for now)
   |
   v
 Access list and needed space, plain code
   |  parts cannot fit -> FAIL before any paid call
   v
 Concept picture, image AI
   |
   v
 Body stage: the AI writes the outer form, a look review compares it with the picture
   |  the back must be flat; the best try is frozen
   v
 Case stage: the AI places parts and calls tested pieces for the inside
   |
   v
 Code runs in a sandbox, then fixed checks measure the exported files
   |  fail -> errors go back to the AI, until a stop rule ends it
   v
 PASS, PASS WITH WARNINGS, or FAIL -> one retry with a fresh body
```

The split follows the rest of the product: the AI chooses, plain code builds and checks.

## Checks

**Must pass**, or the customer gets no model:

| Area | Checks |
|---|---|
| Printable | Each part is a sealed single solid, walls at least 1.6 mm (Shell, cover) or 1.2 mm (holder), each part has a flat side for the bed, the rear cover is at least 90% flat |
| Fit | Parts keep their real size, gaps of at least 0.1 mm, nothing overlaps |
| Assembly | Each part reaches its place in a straight line; snap hooks are checked separately |
| Held | Boards and holders move at most 0.5 mm; a sitting board may be glued instead |
| Fastening | Screws have a driver path, a seat and grip, and screws and snaps spread across the cover |
| Access | Screen, inputs and power reach the outside through fitted openings |
| Outside | Only the Shell and the flat back of the cover form the outside |
| Connections | USB plug room, knob shaft hole, touch opening, jumper plug room |
| Desk | The case stands, with its weight inside its footprint |

**Warnings**, which go on the print checklist: looks, window fit, wire routes, openings that are not fitted, how closely the layout follows the base design, small thin spots.

## Stop rules

A run ends when any of these happens: the try limit, six crashes, the same failure twice, getting worse, no progress, a token limit or a time limit. A failed run gives no model.

## Results

Runs start from nothing on `gpt-6.1-sol`, with nobody stepping in. Some part pairings were held back and run only after the code was frozen.

| Stage | What changed | Result |
|---|---|---|
| First runs | AI writes everything | Most runs failed, about 150k to 230k tokens |
| Rules and severity | Must-pass and warnings, standing design rules | First passes, still 160k to 230k tokens |
| Flat-on-bed check | From a test-print review: the cover was not flush with the bed | Rounded covers rejected, and the AI fixed it from the error alone |
| Parts library | Tested pieces for the inside | About 70% cheaper on the tuning designs |
| Held-back tests | New pairings after the code froze | First 0 of 3, then 2 of 3 and 3 of 3 after general fixes |
| Retry and snap | One retry; a snap latch where no screw fits | A design that failed 3 of 4 times passed first time |

Latest: about 73% of runs pass, at about 40k to 110k tokens, against about 197k before the library. Nothing has been printed.

## Files

| File | What it does |
|---|---|
| `generate.py` | One customer request: run, retry once, plain result |
| `agent.py` | One run: body stage, case stage, the loop and stop rules |
| `body_stage.py` | The outer form and its look review |
| `case_parts.py`, `case_example.py`, `library_brief.py` | The parts library, its worked example and its brief |
| `access.py`, `part_data.py` | What must reach outside, needed space, part sizes |
| `checks.py`, `case_checks.py`, `wiring_checks.py`, `space_checks.py`, `layout_checks.py`, `severity.py` | The checks |
| `card.py`, `cards/` | Part cards, measured from the AWS models |
| `base_designs/` | Hand-written layouts for now |
| `viewer.py`, `preview.py`, `slicer_check.py` | The 3D viewer, previews and the slicer check |
| `sandbox.py` | Runs generated code with a time limit and no keys. A local stand-in, not a security boundary |

## Running it

From `enclosure/`, with `OPENAI_API_KEY` in `.env`:

```text
.venv/Scripts/python -W ignore generate.py base_designs/<design>.json <job name>
.venv/Scripts/python -W ignore -m unittest test_case_parts test_rules test_layout test_agent test_card test_checks test_wiring test_knob test_generate
```

Results are in `enclosure/runs/`, which is not committed.

## Not built yet

- The Generate button, background jobs with progress, and the viewer and downloads in the product
- Questions and mock-ups that produce the base design, and asking the user to confirm openings
- An isolated task per try on AWS, with no internet and no keys
- A GLB and 3MF package, build steps and a cost report
- A test print of the latest cases
