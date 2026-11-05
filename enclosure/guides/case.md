# Case guide: build the inside of a frozen body, step by step

You work through tools, not one reply. The body is fixed: the case must keep its outside exactly, every feature
included. The fixed checks decide; your job is to make them pass and make the case look like the concept.

## The tools and when to call them

| Tool | Call it when | You get back |
|---|---|---|
| `docs(name)` | before using a library piece you are not sure of | its signature and what it does |
| `measure(code)` | you need a position: where the front is at a spot, the room left, a side's surface | what the snippet prints |
| `write(code)` | once, for the first draft of the script | "Saved" |
| `edit(old, new)` | for every later change: replace one exact piece, copied from `show()` | which line changed, or why nothing did |
| `show(find=... or start, end)` | to see the part you are about to change, never the whole file | numbered lines |
| `run()` | after each change; it runs the saved script | "Ran." or the error |
| `check(group)` | after a run, for the group the last change touched | the failed checks in that group, with fixes |
| `render()` | after the parts and openings are in, and after each look change | a picture of your case next to the concept |
| `submit()` | when `check("all")` would pass, or to keep a better-looking version | all checks plus the look review |

`check("all")` with nothing failing submits for you. `check` and `submit` refuse a script that changed since its
last run: run it first.

## The order that works

1. **Read first, briefly.** One or two `docs()` calls for the pieces you will use (Part, split, pocket, the
   opening for your input, Screw or Snap). Do not read the library's source.
2. **Place the parts.** Load the body, place the screen, the inputs and the controller with `Part`, read the front
   with `deepest_front` / `front_surface`, split at the seam. `run`, then `check("fit")`.
3. **Openings.** Cut pockets, the window, the input's opening and the USB opening. `run`, then `check("openings")`.
4. **Fasteners and outside.** Add screws (or snaps), stops and the holder. Pick positions from `free_spots` and
   `stop_spots`, never by guessing. `run`, then `check("fasteners")` and `check("outside")`.
5. **Look.** `render()`. Compare with the concept: does the case keep every feature, is the bezel even, do the
   openings suit the character? Fix the worst thing, `run`, `render()` again.
6. **Submit.** `submit()`. If it fails, fix what it names, one thing at a time. If it passes under the look target,
   polish (bezel, knob cap shaped for the character, softer openings) and submit again. The best pass is kept,
   so polishing can never make the result worse.

## What good looks like

- Every feature of the body is still there: arms, ears, feet and antennas are never cut, hollowed or left loose.
- The screen sits in an even bezel; openings are sized and rounded to suit the form.
- No screw heads, seams or patches on the front or the top: fasteners go in from the back.
- Details suit the character: a paw-shaped knob cap for an animal, a dial for a radio.

## Working on the saved script

Write the script once with `write`, then change it with `edit`: replace only the lines that need to change, copied
exactly from `show`. An edit that matches 0 or 2+ places changes nothing and says so; include more lines around it.
Every run that works is kept as a snapshot, so a broken edit never loses a version that ran.

## When something fails

A failed build, run, check or submit comes back with what failed, where in your file, and what to try. Diagnose before
switching: read the error, check your assumptions (`measure` what you are unsure of), and make a focused fix to what it
names. Do not rerun the same code unchanged: the harness flags it and it changes nothing. Do not drop a workable
approach after one failure either: change the value the message names, often by the mm it gives.
A building block that had to change what you asked prints a "note" in the build output (for example "built a flatter
top: needs 3 mm more height"). Read the notes: they mean the shape is not what you asked for.

## Budget

Builds, runs, edits, checks and submits count as steps. Looking (`docs`, `show`, `render`, `recall`) is free up to
its own limit of 40 calls, then counts as steps too.

## Do not

- Do not rewrite the whole script when one group fails: `edit` only what the failed checks name.
- Do not cut an opening through a feature. Move the opening or the part instead.
- Do not guess a number you can `measure`.
- Do not make more calls than you need: every call resends everything so far, so a long session runs out of budget.
