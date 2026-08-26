# Makeable Hologram firmware

Target hardware:

- Nologo ESP32-C3 Super Mini / generic ESP32-C3 Super Mini
- GoldenMorning `GME128128-01-1-IIC`, 128×128 monochrome SH1107 OLED
- BLE-only transport; the browser owns all image, GIF, video, and typography rendering

## Wiring

| OLED | ESP32-C3 Super Mini |
|---|---|
| VCC | 3.3V |
| GND | GND |
| SDA | GPIO 8 |
| SCL | GPIO 9 |

The firmware probes I²C address `0x3C`, then `0x3D`. GPIO 8/9 match the
installed Arduino board definition for the Nologo ESP32C3 Super Mini. Override
`HOLOGRAM_SDA_PIN` and `HOLOGRAM_SCL_PIN` at compile time for another board.

## Build

Required Arduino libraries:

- NimBLE-Arduino 2.x
- Adafruit GFX Library
- Adafruit SH110X

Use Espressif's Arduino-ESP32 core `3.3.6` for this ESP32-C3 build. Core
`3.3.7` and later can crash inside the Bluetooth controller during
`NimBLEDevice::init()` on affected hardware revisions. Install the pinned core
before compiling:

```sh
arduino-cli core install esp32:esp32@3.3.6
```

From the Makeable repository root:

```sh
arduino-cli compile \
  --fqbn esp32:esp32:nologo_esp32c3_super_mini \
  --export-binaries \
  hardware/hologram/firmware/hologram-c3
```

Flash over the rear USB-C connection:

```sh
arduino-cli upload \
  --fqbn esp32:esp32:nologo_esp32c3_super_mini \
  --port /dev/cu.usbmodemYOUR_DEVICE \
  hardware/hologram/firmware/hologram-c3
```

## Display contract

The browser sends the exact 2,048-byte framebuffer consumed by
`Adafruit_GrayOLED`: `buffer[x + floor(y / 8) * 128]`, bit `y & 7`. Frames are
sent in ordered 160-byte BLE chunks. Each frame has a sequence number, exact
length, hold time, and CRC32; the device acknowledges only after the SH1107 has
presented it.

See `protocol.h` and `/hologram/ble-protocol.js` for the matching binary
protocol constants.
