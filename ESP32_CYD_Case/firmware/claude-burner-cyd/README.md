# Claude Burner CYD firmware

Target: E32R28T / ESP32-2432S028 style 2.8-inch CYD with an ILI9341V display and CH340C USB serial.

The firmware owns the 320×240 display, RPG LIFE HUD, link watchdog, and
compressed `NO CONNECTION` fallback. The Mac installs the selected GIF into
LittleFS over a COBS-framed, CRC32-protected 2,000,000-baud transport. The ESP32
then decodes that GIF locally at 24 FPS and receives only small HUD/heartbeat
updates until the emotion changes. Frame zero is fully redrawn at every loop
boundary, preventing compact GIF delta rectangles from leaving stale pixels.
The LIFE HUD rectangle is excluded from all GIF scanline writes, so it remains
stable across loop keyframes and is redrawn only when LIFE or level changes.
The offline label is centered inside the fallback artwork's existing top banner;
no additional message rectangle is drawn over Ember.

Build and upload from this directory:

```sh
./scripts/install-platformio.sh
./scripts/flash-connected-cyd.sh
```

Verified display wiring:

| Signal | GPIO |
|---|---:|
| LCD CS | 15 |
| LCD DC | 2 |
| LCD SCLK | 14 |
| LCD MOSI | 13 |
| LCD MISO | 12 |
| Backlight | 21 |

The display reset is shared with the ESP32 enable/reset circuit, so `TFT_RST=-1` is intentional.
