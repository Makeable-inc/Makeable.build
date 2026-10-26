# API Notes

These are the implementation assumptions used before coding the prototype.

## OpenAI

- Use the Responses API for image understanding and JSON output.
- Image input uses `input_image` with an `image_url`, including data URLs for uploaded browser images.
- Structured output uses `text.format` with `type: "json_schema"`, `strict: true`, and a full JSON schema.
- The prototype calls OpenAI through `POST /api/openai/responses`, a tiny local proxy backed by `OPENAI_API_KEY`.
- Hosted long-running guide/code/check calls use `POST /api/openai/background` with `background: true`, then poll `GET /api/openai/responses/{id}` until the response completes. This avoids Netlify inactivity timeouts while preserving the expensive vision/reasoning model path.
- Default model choices are set in `.env`: `OPENAI_MODEL=gpt-5.6-terra` for part planning and `OPENAI_REASONING_MODEL=gpt-5.6-terra` for behavior verification.
- `OPENAI_REASONING_EFFORT=xhigh` is the quality-focused reasoning default, while `OPENAI_SERVICE_TIER=priority` keeps requests on the fastest configured service tier. The backend falls back to the standard service tier if the project cannot use priority capacity.

Docs:

- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/all

## Deepgram

- Live speech-to-text uses `wss://api.deepgram.com/v1/listen`.
- The browser connects to Makeable with an authenticated WebSocket subprotocol. The ECS API opens the Deepgram connection and keeps the provider key server-side.
- Audio capture uses `MediaRecorder` with `audio/webm;codecs=opus` when supported.
- Production never sends the Deepgram key or a provider token to the browser.

Docs:

- https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- https://developers.deepgram.com/docs/using-the-sec-websocket-protocol
- https://developers.deepgram.com/docs/encoding

## Web Serial

- Web Serial is used for ESP32 serial logs: `navigator.serial.requestPort()`, `port.open({ baudRate })`, then `TextDecoderStream` over `port.readable`.
- Web Serial requires a secure context. Chrome treats localhost as acceptable for development.
- The UI filters common USB serial adapters: Silicon Labs CP210x, WCH CH340, FTDI, and Espressif native USB.

Docs:

- https://developer.chrome.com/docs/capabilities/serial
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API

## ESP32 Flashing

- The hosted backend compiles generated ESP32 Arduino-core `.ino` sketches through `POST /api/firmware/compile`.
- The production container bundles the compiler, ESP32 core, and supported libraries; users do not install Arduino IDE, VS Code, ESP-IDF, or a compiler toolchain.
- The backend selects an allowlisted ESP32-family target from recognized hardware. Clients cannot submit an arbitrary FQBN.
- esptool-js flashes the compiled binary images directly from the browser via Web Serial.

Docs:

- https://esphome.github.io/esp-web-tools/
- https://github.com/espressif/esptool-js
- https://espressif.github.io/esptool-js/docs/index.html
