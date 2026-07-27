FROM node:22-bookworm-slim

ARG ARDUINO_CLI_VERSION=1.5.1
ARG ESP32_CORE_VERSION=3.3.5

ENV NODE_ENV=production \
    PORT=10000 \
    ARDUINO_CLI_PATH=/usr/local/bin/arduino-cli \
    ARDUINO_BUILD_CACHE_PATH=/opt/arduino/cache \
    ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_DOWNLOADS=/opt/arduino/downloads \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --retry 4 \
      "https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_CLI_VERSION}/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_64bit.tar.gz" \
      | tar -xz -C /usr/local/bin arduino-cli \
    && chmod 0755 /usr/local/bin/arduino-cli \
    && mkdir -p /opt/arduino/data /opt/arduino/downloads /opt/arduino/user \
    && arduino-cli core update-index \
      --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json \
    && arduino-cli core install "esp32:esp32@${ESP32_CORE_VERSION}" \
      --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json \
    && arduino-cli lib install \
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
      "PubSubClient" \
    && rm -rf /opt/arduino/downloads/*

# The ESP32 build recipes invoke Python at compile time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

# Precompile the ESP32 cores into a shared cache. This moves the slowest part of
# a user's first generation into the image build and keeps every live instance
# ready for all supported ESP32-family targets.
RUN mkdir -p /opt/arduino/cache /tmp/MakeableWarmup \
    && printf 'void setup() {}\nvoid loop() {}\n' > /tmp/MakeableWarmup/MakeableWarmup.ino \
    && for fqbn in \
      esp32:esp32:esp32 \
      esp32:esp32:esp32s2 \
      esp32:esp32:esp32s3 \
      esp32:esp32:esp32s3:FlashMode=qio,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi \
      esp32:esp32:esp32c3 \
      esp32:esp32:esp32c6; do \
        arduino-cli compile \
          --jobs 2 \
          --fqbn "$fqbn" \
          /tmp/MakeableWarmup; \
      done \
    && rm -rf /tmp/MakeableWarmup \
    && chown -R node:node /opt/arduino/cache

ENV ARDUINO_COMPILE_JOBS=1 \
    MAX_CONCURRENT_COMPILES=1 \
    COMPILE_TIMEOUT_MS=300000

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
RUN mkdir -p /app/.makeable/builds && chown -R node:node /app/.makeable

USER node
EXPOSE 10000
CMD ["node", "server.mjs"]
