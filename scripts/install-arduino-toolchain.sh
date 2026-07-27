#!/usr/bin/env bash
set -euo pipefail

ARDUINO_VERSION="${ARDUINO_CLI_VERSION:-1.5.1}"
ESP32_VERSION="${ESP32_CORE_VERSION:-3.3.5}"
TOOLCHAIN_ROOT="${MAKEABLE_TOOLCHAIN_ROOT:-.makeable/toolchain}"
BIN_DIR="${TOOLCHAIN_ROOT}/bin"
CLI_PATH="${BIN_DIR}/arduino-cli"

mkdir -p "${BIN_DIR}" "${TOOLCHAIN_ROOT}/data" "${TOOLCHAIN_ROOT}/downloads" "${TOOLCHAIN_ROOT}/user"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ARCHIVE="arduino-cli_${ARDUINO_VERSION}_macOS_ARM64.tar.gz" ;;
  Darwin-x86_64) ARCHIVE="arduino-cli_${ARDUINO_VERSION}_macOS_64bit.tar.gz" ;;
  Linux-x86_64) ARCHIVE="arduino-cli_${ARDUINO_VERSION}_Linux_64bit.tar.gz" ;;
  *) echo "Unsupported test host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

if [[ ! -x "${CLI_PATH}" ]]; then
  curl --fail --location --retry 4 \
    "https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_VERSION}/${ARCHIVE}" \
    | tar -xz -C "${BIN_DIR}" arduino-cli
fi

export ARDUINO_DIRECTORIES_DATA="${PWD}/${TOOLCHAIN_ROOT}/data"
export ARDUINO_DIRECTORIES_DOWNLOADS="${PWD}/${TOOLCHAIN_ROOT}/downloads"
export ARDUINO_DIRECTORIES_USER="${PWD}/${TOOLCHAIN_ROOT}/user"

"${CLI_PATH}" core update-index \
  --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
"${CLI_PATH}" core install "esp32:esp32@${ESP32_VERSION}" \
  --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
"${CLI_PATH}" lib install \
  "Adafruit Unified Sensor" \
  "Adafruit MPU6050" \
  "Adafruit BME280 Library" \
  "BH1750" \
  "Adafruit VL53L0X" \
  "Adafruit SGP30 Sensor" \
  "HX711 Arduino Library" \
  "DHT sensor library" \
  "Adafruit NeoPixel" \
  "ESP32Servo" \
  "Adafruit GFX Library" \
  "Adafruit SSD1306" \
  "ArduinoJson" \
  "PubSubClient"

echo "Toolchain ready: ${PWD}/${CLI_PATH}"
