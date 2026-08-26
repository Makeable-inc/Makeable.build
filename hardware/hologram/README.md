# Makeable Hologram software

This directory contains the device half of `https://makeable.build/hologram`.
The web app performs media decoding and monochrome conversion locally, then
streams a checked 128×128 framebuffer over BLE. No Wi-Fi credentials, cloud
media upload, or device-side GIF/video decoder are required.

The firmware source is in `firmware/hologram-c3/`. The web client and matching
protocol implementation are in the repository's `hologram/` directory.

