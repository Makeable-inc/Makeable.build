# Makeable

## Codex For Hardware

**Makeable** is an AI hardware-building buddy that turns messy IoT prototyping into a fun, LEGO-like experience.

Building with ESP32s can feel scary when you are new: sensors, wires, pin diagrams, Arduino setup, firmware, flashing, terminal logs, and debugging all show up at once. Makeable turns that chaos into a friendly step-by-step build guide using your own parts photo.

Upload a photo. Say what you want to build. Let Makeable guide the rest. 🧩⚡

Makeable deliberately supports the **ESP32 family only**: ESP32, S2, S3, C3, and C6. Arduino Uno/Nano/Mega and other microcontroller families are not accepted as build targets.

![Makeable workbench concept](design/makeable-ui-concept.png)

---

## The Big Idea 💡

Instead of making beginners jump between wiring diagrams, Arduino IDE, random tutorials, and serial monitors, Makeable keeps the whole hardware journey in one place.

It can:

- 📸 Look at your real parts photo
- 🧠 Identify only the components your project needs
- 🏷️ Label the useful parts directly on the image
- 🔌 Walk you through the wiring one move at a time
- 💻 Generate ESP32 firmware for your idea
- 🚀 Flash the code into the board without touching Arduino IDE
- 👀 Debug the real build using terminal logs and webcam evidence
- 📚 Keep the final project guide and test notes together

---

## Why We Built It 🛠️

Tiny hardware mistakes can break the whole project.

Wrong pin? Nothing works.

Missing ground? Mystery bug.

Bad code upload? More confusion.

Serial log error? Time to panic-scroll forums.

Makeable is designed to feel like a calm friend beside you saying:

> “No worries. Pick up this wire. Put it here. I’ll check the next part with you.”

That is the heart of **Codex For Hardware**.

---

## Visual Proof: The Build Journey 🧪

### 1. Start With What You Have 📸

Lay out your parts, upload one clear photo, then type or speak the thing you want to make.

In this demo, the user wants a motion-triggered light build.

![Step 1 upload photo and speak your idea](images/step%201%20-%20upload%20pic%20and%20speak%20your%20idea.jpg)

### 2. AI Finds the Useful Parts 🧠

Makeable reads the photo and focuses on the parts needed for the project. Extra parts are ignored so the screen does not become label soup.

![AI labels the needed hardware parts](images/step%202%20-%20image%201.jpg)

### 3. One Connection at a Time 🔌

The guide does not dump every wire on you at once. It highlights the current move, shows the exact parts on your own photo, and keeps the instruction simple.

![Makeable shows one wiring move at a time](images/step%202%20-%20image%202.jpg)

### 4. A Clean Final Guide ✅

Each step is built around the photo, the selected parts, and a clear action. It feels closer to LEGO instructions than a scary circuit diagram.

![Final guided wiring image](images/step%202%20-%20final%20image.jpg)

### 5. Connect the Board 🔌

Connect the ESP32 by USB. Makeable infers the supported board target from the recognized hardware; ordinary users do not see compiler settings or source code.

### 6. Flash the Code Into the Board 🚀

The app generates firmware and loads it directly into the ESP32. No Arduino IDE adventure required.

![Flashing code into the ESP32 board](images/flashing%20loading%20code%20into%20board.jpg)

### 7. Closed-Loop Debugging 👀⚡

After flashing, Makeable can check terminal logs and webcam footage to confirm the physical project is actually doing what it should.

![Closed loop debugging with terminal logs and webcam](images/closed%20loop%20debugging%20system%20with%20terminal%20logs%20and%20webcam.jpg)

### 8. Project Notes 📚

When the build works, Makeable packages the project guide, parts, and test results into readable notes within the build session.

![One button upload project to GitHub](images/one%20button%20click%20upload%20project%20to%20github.jpg)

---

## What Makes It Different ✨

| Old Hardware Workflow 😵 | Makeable Workflow ✨ |
| --- | --- |
| Search for wiring diagrams | Upload your own parts photo |
| Guess which parts matter | AI marks only the needed parts |
| Read a giant pinout chart | Follow one small move at a time |
| Copy random Arduino code | Generate firmware for your exact idea |
| Manually compile and flash | Load code directly into the ESP32 |
| Debug alone with serial logs | AI checks logs + webcam evidence |
| Write docs after everything | Automatic in-session project notes |

---

## Core Features 🌟

### 📷 Photo-Based Part Detection

Makeable uses the user’s real photo as the source of truth. The guide is not generic. It points to the actual objects on the table.

### 🪜 Step-by-Step Wiring

The guide shows one connection at a time so beginners can move slowly and confidently.

### 💻 Secure Firmware Generation

The app generates ESP32-ready firmware based on the project goal and detected components. The source stays inside the Makeable workflow.

### 🔌 Direct Flashing

The Render container owns Arduino CLI, the ESP32 core, and common libraries. The browser receives a compiled binary and flashes it with Web Serial, so the user installs no IDE, CLI, extension, or SDK.

### 👀 Closed-Loop Debugging

The app can inspect serial logs and webcam evidence, then explain whether the physical build is behaving correctly.

### 📚 Build Notes

The final project is packaged into a readable guide in the final stage.

---

## Tech Stack 🧰

- **Frontend:** HTML, CSS, JavaScript
- **AI planning:** OpenAI Responses API
- **Voice input:** Deepgram transcription through an authenticated server-side WebSocket proxy
- **Accounts:** Amazon Cognito PKCE sign-in + DynamoDB credit ledger
- **Login branding:** Cognito Managed Login, styled with Makeable assets in `infra/cognito-managed-login-branding.json`
- **Firmware compile:** pinned Arduino CLI + ESP32 core in an AWS ECS Docker container
- **Board flashing:** Web Serial + ESP flashing flow
- **Debugging:** Serial logs + webcam evidence
- **Hosting:** Netlify frontend + CloudFront + AWS ECS Fargate Express Mode API

---

## Local Development 🏃

```bash
npm run toolchain:install
node server.mjs
```

Then open:

```text
http://127.0.0.1:8787
```

Chrome or Edge is required for Web Serial board flashing. This local setup is only for Makeable developers; end users visit `makeable.build` and install nothing.

---

## Environment Setup 🔐

Create a `.env` file:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_REASONING_MODEL=gpt-5.6-terra
OPENAI_REASONING_EFFORT=xhigh
OPENAI_SERVICE_TIER=priority

DEEPGRAM_API_KEY=

GITHUB_TOKEN=
GITHUB_OWNER=

ARDUINO_CLI_PATH=.makeable/toolchain/bin/arduino-cli

PORT=8787
```

`npm run toolchain:install` installs the pinned CLI and ESP32 core into the ignored `.makeable/toolchain` development directory. Production gets the same toolchain from `Dockerfile`.

---

## Beginner Safety Notes 🧯

- Power the board by USB first.
- Always connect ground before trusting signal wires.
- Double-check the board pin labels before flashing.
- Disconnect power before changing messy wiring.
- If something gets hot, stop immediately.

Hardware should feel fun, not frightening. ⚡

---

## Project Vision 🌈

Makeable is not just a code generator.

It is a hardware companion that watches the whole loop:

```text
parts photo → AI guide → wiring steps → firmware → flashing → real-world check → build notes
```

The dream is simple:

> Anyone should be able to build useful electronics without feeling lost in the wires.

---

## Name

**Makeable**<br>
**Tagline:** Codex For Hardware

Small tool. Big hardware confidence. ⚡
