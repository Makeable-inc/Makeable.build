# Claude Burner 1.1.1

Claude Burner is a persistent three-form Tamagotchi for the 320x240 E32R28T
ESP32 CYD display. Claude Code activity charges Ember's stored LIFE; inactivity
degrades its mood, volcano, size, and eventually returns it to a small, moody
sleeping presentation.

## Install the Mac app

1. Open `release/Claude Burner-1.1.1-arm64.dmg`.
2. Drag **Claude Burner** to **Applications**.
3. Because this prototype is intentionally unsigned, Control-click the app and
   choose **Open**. If macOS still blocks it, open **System Settings > Privacy &
   Security**, scroll down, and choose **Open Anyway**. The app includes a
   user-clicked shortcut to that pane. It never disables Gatekeeper or removes
   quarantine.
4. Click **Connect Claude Code** in the app. This is the consent step that
   installs the reversible status-line fallback while active usage sync starts
   automatically.

## Reliable Claude usage detection

After the user clicks **Connect Claude Code**, version 1.1.1 actively reads
Claude Code's official built-in `/usage` screen once a minute. It starts an
empty safe-mode session in an app-owned directory, runs only `/usage`, captures
the five-hour percentage and reset time, then terminates the empty PTY. `/usage`
is a local UI command rather than a model prompt; a live validation reported
`$0.0000`, zero input tokens, and zero output tokens.

The reversible Claude Code status-line bridge remains installed as an
independent fallback. Claude Burner merges both sources by reset window and
uses the highest valid percentage, so simultaneous sessions cannot double-award
LIFE. A stale snapshot from an expired window is rejected even if an old Claude
process keeps refreshing its file. The app also preserves a confirmed Max 5x or
Max 20x choice instead of allowing generic or delayed plan telemetry to
downgrade it.

The active probe never reads Claude credentials, conversation transcripts, or
prompt text. It sets Claude Code's documented
`CLAUDE_CODE_SKIP_PROMPT_HISTORY` privacy control, and live testing confirmed
that neither command history nor project transcripts increased after a refresh.
Its workspace is an empty folder with owner-only permissions under Claude
Burner's Application Support directory; only that folder's one-time Claude
trust prompt may be acknowledged automatically. If the active probe is
temporarily unavailable, the app keeps using fresh status-line observations and
shows the current source in **Tune > Usage sync**. **Refresh Claude usage**
forces an immediate active check.

Claude documents `/usage` as the command for current plan usage limits and the
status line's `rate_limits` fields as the machine-readable usage source:
[Claude Code commands](https://code.claude.com/docs/en/commands),
[status-line reference](https://code.claude.com/docs/en/statusline),
[session privacy controls](https://code.claude.com/docs/en/sessions).

Claude Code 2.1.80 or newer is required for the status-line fallback; active
safe-mode sync requires 2.1.169 or newer. Plan detection uses `claude auth
status`; credentials are never read. If a previous status-line command exists,
Claude Burner chains it and restores it on uninstall. The bridge receives only
Claude Code's status-line JSON over stdin and writes a local `UsageSnapshot` in
the app's Application Support directory.

The app background follows the active Ember scene. Every visited size/emotion
combination remains permanently unlocked and appears in a horizontal,
scrollable carousel below the animation.

## LIFE model

Positive changes in the highest observed five-hour usage percentage earn:

`LIFE gain = 0.5 * positive usage delta * plan multiplier`

| Plan | Multiplier | LIFE per 1% |
|---|---:|---:|
| Pro | 1x | 0.5 |
| Max 5x | 5x | 2.5 |
| Max 20x | 20x | 10 |

Each five-hour window is capped at 100 earned LIFE, and simultaneous Claude
sessions are deduplicated by the reset timestamp and highest observed usage.
Free accounts use manual/demo mode.

Plan-relative usage is converted to Pro-equivalent work before LIFE is awarded.
For example, 40% of a Pro window, 8% of a Max 5x window, and 2% of a Max 20x
window each earn 20 LIFE. A confirmed Max choice is persisted and takes
precedence over a generic or stale plan reported by `claude auth status`.

Evolution uses hysteresis: Level 1 evolves at 36 LIFE, Level 2 evolves at 69,
Level 3 regresses below 65, and Level 2 regresses below 32. After a two-hour
grace period, inactivity drains 100 LIFE linearly over the next 58 hours. State
is written atomically and Mac/app downtime does not pause decay.

Recent activity is tracked independently as SPARK. It has a 30-minute grace
period and decays to zero over the following 11.5 hours. SPARK selects Moody,
Hopeful, Cheerful, Excited, or Explosion, so every emotion can occur at every
physical size. Permanent bond XP and unlocked states never decay.

## Display transport

Protocol v2 installs the selected 320x240 GIF into the ESP32's LittleFS flash
partition over CH340C USB serial at 2,000,000 baud. The firmware then decodes
and loops that GIF locally; USB is no longer responsible for every animation
frame. A new upload occurs only when Ember changes to a different emotion.
Repeated requests for the current GIF are verified cache hits, while LIFE HUD
changes remain tiny independent packets.

Each upload uses 12 KB chunks with COBS framing, CRC32, monotonic sequence
numbers, ACK/NACK recovery, and an end-to-end GIF checksum before playback.
All 15 states use the same optimized GIF for desktop and device playback:
320×240, 96 frames, four seconds, and exact 24 FPS using a repeating 40/40/40/40/40/50
ms delay pattern. The background and face never redraw. Ember stays lively via
an intact integer-pixel molten-purr motion and a face-excluded warm pulse in its
flame and exterior fissures; there are no blinks or synthetic outlines.

Each device loop keeps a full 320x240 keyframe followed by bounded motion
rectangles. Firmware explicitly redraws the complete first frame on every loop,
then renders each later rectangle as ordered raw scanlines. This prevents stale
partial-frame pixels from accumulating in the middle of the display. The
firmware HUD is a protected layer: GIF scanlines are split around
`(8,8)-(127,34)`, so the LIFE bar is not repainted or flashed at the animation
boundary. All 15 loops passed upload, local-loop, deferred activation, and cache
tests on the physical non-PSRAM ESP32 at 11.94–12.07 FPS. GIFs range from
105,802 to 551,199 bytes under the 550 KiB atomic-install limit; the slowest
sampled frame rendered in 44.96 ms inside the shortest 80 ms frame budget.
Larger transfers exercised bounded chunk retries and recovered without losing
the active animation. Firmware reports frame, loop, and render-time telemetry
in acknowledgements.

The offline artwork's built-in banner at `x=66-254, y=45-68` contains the
firmware-rendered `NO CONNECTION` label. Firmware does not add a second box or
cover dormant Ember.

If app heartbeats disappear for 1.5 seconds, firmware renders its compressed
offline scene. If USB is present but Claude data is unavailable, it displays
`WAITING FOR CLAUDE`. The pixel LIFE HUD is always firmware-rendered at `(8,8)`.

## Developer commands

Desktop app:

```sh
cd claude-burner-desktop
npm install
npm test
npm run dist:mac
```

Firmware:

```sh
cd firmware/claude-burner-cyd
./scripts/install-platformio.sh
./scripts/flash-connected-cyd.sh
```

Physical local-GIF test (optional scene names can follow the script):

```sh
cd claude-burner-desktop
BURNER_GIF_HOLD_MS=7000 BURNER_GIF_AUDIT_PATH=assets/audits/hardware-gif-audit.json \
  npm run test:hardware:gifs -- small_moody large_explosion

# Destructive-boundary fault injection: active.gif must survive each case.
npm run test:hardware:faults
```
