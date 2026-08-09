# Claude Burner CYD firmware

Target: E32R28T / ESP32-2432S028 style 2.8-inch CYD with an ILI9341V display and CH340C USB serial.

The firmware owns the 320×240 display, RPG LIFE HUD, link watchdog, and
compressed `NO CONNECTION` fallback. The Mac installs the selected GIF into
LittleFS over a COBS-framed, CRC32-protected 2,000,000-baud transport. The ESP32
then decodes that GIF locally using its embedded frame delays (the production
library repeats 80/80/90 ms for exact 12 FPS) and receives only small HUD/heartbeat updates
until the state changes. Frame zero is fully redrawn at every loop boundary,
preventing compact GIF delta rectangles from leaving stale pixels. The LIFE HUD
rectangle is excluded from all GIF scanline writes, so it remains stable across
loop keyframes and is redrawn only when LIFE or level changes. The offline label
is centered inside the fallback artwork's existing top banner; no additional
message rectangle is drawn over Ember.

## Rollback-safe GIF installation

GIF replacement never writes to the file being played:

1. `GifBegin` rejects files larger than 550 KiB, clears only stale staging
   files, and opens `/incoming.gif`. `/active.gif` keeps playing.
2. Ordered `GifChunk` packets append to the incoming file. A retransmission
   using the same protocol sequence number is idempotent because the prior ACK
   is replayed without writing the chunk twice.
3. `GifCommit` closes and flushes the incoming file, compares the streamed CRC,
   recalculates CRC32 from flash, requires a 320×240 canvas and a full-canvas,
   top-to-bottom first frame, then decodes the complete GIF with AnimatedGIF.
   Validation is bounded to 512 frames.
4. If an active loop exists, the validated replacement waits for that loop's
   boundary. With no active loop, it is installed immediately.
5. Promotion renames the old file to `/rollback.gif`, promotes the staged file,
   opens it, and draws its first frame before deleting the rollback. Any rename,
   open, or first-frame failure restores and redraws the previous GIF.
6. On boot, the presence of `/rollback.gif` means promotion was interrupted;
   firmware restores it before deleting incomplete staging files.

A `GifCommit` ACK means the candidate was fully validated, promoted, and its
complete frame zero has decoded and drawn. Protocol version 2 defers that ACK
until the active loop reaches its boundary. A promotion failure
returns a NACK for the original commit sequence. Duplicate retries of that
sequence are suppressed while pending and replay the cached terminal ACK/NACK
after resolution. CRC and full-decode validation happen synchronously during
commit, so the old image can hold briefly while validation runs; uploads
themselves do not pause playback. Valid duplicate retries refresh link activity
without being executed twice. Chunk and commit retries use a one-second timeout,
remaining below the strict 1.5-second watchdog. Repeated same-sequence COMMITs
therefore act as keepalives while the four-second loop reaches its boundary;
twelve retries leave ample CRC/decode/promotion margin without weakening cable
loss detection. If the keepalives stop, the watchdog cancels staging, preserves
the known-good active file, and displays `NO CONNECTION` within 1.5 seconds.
The default 4 MB ESP32 partition layout provides a 0x160000-byte LittleFS data
partition, enough for one 550 KiB active GIF plus one 550 KiB incoming GIF and
filesystem overhead.

After a transient watchdog fallback, the next valid heartbeat restores the
last requested `STREAMING` or `WAITING FOR CLAUDE` state. Streaming reopens the
persisted `/active.gif`; it does not depend on the desktop re-uploading an
unchanged scene.

An apparent GIF cache hit re-reads the complete active file and verifies its
CRC32 in addition to checking metadata and length, so flash corruption cannot
survive a reselect.

Build and upload from this directory:

```sh
./scripts/install-platformio.sh
./scripts/flash-connected-cyd.sh
```

Run the firmware decoder and production-contract check against one or more GIFs:

```sh
./scripts/validate-device-gif.sh path/to/first.gif path/to/second.gif
./scripts/test-firmware-native.sh
```

The native check uses the same pinned AnimatedGIF source as the firmware and
also enforces the production contract: 320×240, 48 frames, repeating 80/80/90
ms delays totaling four seconds (exact 12 FPS),
infinite loop, full top-to-bottom frame zero, and no more than 550 KiB.

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
