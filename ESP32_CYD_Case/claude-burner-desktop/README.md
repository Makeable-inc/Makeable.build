# Claude Burner 1.0.7

Claude Burner is a persistent three-form Tamagotchi for the 320x240 E32R28T
ESP32 CYD display. Claude Code activity charges Ember's stored LIFE; inactivity
degrades its mood, volcano, size, and eventually returns it to a dormant baby.

## Install the Mac app

1. Open `release/Claude Burner-1.0.7-arm64.dmg`.
2. Drag **Claude Burner** to **Applications**.
3. Because this prototype is intentionally unsigned, Control-click the app and
   choose **Open**. If macOS still blocks it, open **System Settings > Privacy &
   Security**, scroll down, and choose **Open Anyway**. The app includes a
   user-clicked shortcut to that pane. It never disables Gatekeeper or removes
   quarantine.
4. Click **Connect Claude Code** in the app. This is the consent step that
   installs the reversible status-line bridge.
5. Run Claude Code and complete one response. Claude Code then supplies its
   authoritative five-hour `used_percentage` to the bridge.

Claude Code 2.1.80 or newer is required. Plan detection uses `claude auth
status`; credentials are never read. If a previous status-line command exists,
Claude Burner chains it and restores it on uninstall. The bridge receives only
Claude Code's status-line JSON over stdin and writes a local `UsageSnapshot` in
the app's Application Support directory.

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

Evolution uses hysteresis: Level 1 evolves at 36 LIFE, Level 2 evolves at 69,
Level 3 regresses below 65, and Level 2 regresses below 32. After a two-hour
grace period, inactivity drains 100 LIFE linearly over the next 58 hours. State
is written atomically and Mac/app downtime does not pause decay.

## Display transport

Protocol v2 installs the selected 320x240 GIF into the ESP32's LittleFS flash
partition over CH340C USB serial at 2,000,000 baud. The firmware then decodes
and loops that GIF locally; USB is no longer responsible for every animation
frame. A new upload occurs only when Ember changes to a different emotion.
Repeated requests for the current GIF are verified cache hits, while LIFE HUD
changes remain tiny independent packets.

Each upload uses 12 KB chunks with COBS framing, CRC32, monotonic sequence
numbers, ACK/NACK recovery, and an end-to-end GIF checksum before playback.
Device-tuned GIFs run at a true 24 FPS and keep a full 320x240 keyframe followed
by compact central motion rectangles. Firmware explicitly redraws the complete
first frame on every loop, then renders each later rectangle as ordered raw
scanlines. This prevents stale partial-frame pixels from accumulating in the
middle of the display. The firmware HUD is a protected layer: GIF scanlines are
split around `(8,8)-(127,34)`, so the LIFE bar is not repainted or flashed at
the two-second animation boundary. All ten emotion loops have been upload-,
loop-, and cache-tested on the physical non-PSRAM ESP32 at 24.1-24.6 FPS. The
largest loop is about 397 KB, and firmware reports frame, loop, and render-time
telemetry in acknowledgements.

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
BURNER_GIF_HOLD_MS=5000 node scripts/hardware-gif-smoke.js lv1_dormant lv3_supercharged
```
