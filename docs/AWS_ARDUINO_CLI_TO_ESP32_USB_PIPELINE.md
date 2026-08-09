# Makeable hosted Arduino CLI compilation and browser-to-ESP32 flashing

## Purpose

This document explains how Makeable compiles ESP32 Arduino firmware on AWS and then transfers the compiled firmware to a user's board through the USB cable connected to the user's computer.

The description is verified against the implementation in Git commit `afdb74b` on branch `codex/claude-burner-lively-gifs`. The source files listed in [Source map](#source-map) are the authority when the implementation changes.

## The most important architectural fact

**The AWS server does not access the user's USB port.**

AWS performs compilation only. It returns flashable binary segments to the authenticated browser over HTTPS. The browser asks the user for permission to access a local serial device, decodes the returned segments, and flashes the ESP32 locally with `esptool-js` over Web Serial.

That separation is the reason the product can offer hosted compilation without installing Arduino IDE or Arduino CLI on the user's computer:

```text
Generated Arduino sketch
        |
        | authenticated HTTPS POST
        v
AWS ECS API: /api/firmware/compile
        |
        | arduino-cli compile
        v
Sparse ESP32 .bin segments + flash addresses
        |
        | JSON response; binary bytes are Base64-encoded
        v
Browser running Makeable
        |
        | esptool-js + Web Serial, after user selects a port
        v
USB serial bridge / native USB
        |
        v
ESP32 flash memory
```

## AWS deployment architecture

| Layer | Repository configuration | Responsibility |
| --- | --- | --- |
| Image registry | `infra/aws-bootstrap.yml` | Creates the private ECR repository `makeable-esp32-api`; scans pushed images and retains the five newest images. |
| Container build | `infra/aws-bootstrap.yml`, `buildspec.aws.yml` | Creates a privileged CodeBuild project that builds the Docker image and pushes both a commit-based tag and `latest` to ECR. |
| Compiler image | `Dockerfile` | Pins Node, Arduino CLI, the ESP32 Arduino core, libraries, Python, build directories, and compiler resource limits. |
| Fast application release | `Dockerfile.runtime` | Reuses the last validated toolchain image and overlays only `package.json`, `package-lock.json`, `server.mjs`, and `lib/`. |
| Runtime service | `infra/aws-service.yml` | Runs the API as an ECS Express Gateway service with a health check, logs, environment variables, and Secrets Manager references. |
| Identity and credits | `infra/aws-auth.yml` | Creates Cognito, DynamoDB credit tables, and the ECS task role used by the API. |
| Frontend routing | `netlify/functions/api.mjs`, `src/makeable/api-client.js` | Publishes the API base URL, attaches the Cognito access token, and calls the hosted API. |
| Compile endpoint | `server.mjs` | Validates the request, runs Arduino CLI, collects the exact binary segments and addresses, and deletes the temporary build directory. |
| Local board flashing | `src/makeable/actions.js` | Requests the serial port, decodes the segments, runs `esptool-js`, reports progress, resets the ESP32, and disconnects cleanly. |

AWS documents `AWS::ECS::ExpressGatewayService` as a container web-service resource that manages load balancing, target groups, security groups, health monitoring, and auto scaling around the primary container. The repository uses that CloudFormation resource directly: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-expressgatewayservice.html>.

## Building the compiler image

### Pinned toolchain

The full `Dockerfile` starts from `node:22-bookworm-slim` and pins:

- Arduino CLI `1.5.1` at `/usr/local/bin/arduino-cli`.
- Espressif Arduino core `esp32:esp32@3.3.5`.
- Arduino data, download, user, and cache directories under `/opt/arduino`.
- Python 3 because ESP32 build recipes invoke Python during compilation.
- A defined set of commonly used sensor, display, JSON, MQTT, servo, and NeoPixel libraries.

The image build downloads the CLI release, updates the ESP32 package index, installs the pinned core, installs the allowlisted libraries, and clears the downloads directory.

Arduino CLI's `compile` command accepts an FQBN and a `--build-path` for compiled output. That is the same mechanism used by `server.mjs`: <https://arduino.github.io/arduino-cli/latest/getting-started/>.

### Warm compiler caches

The `Dockerfile` compiles a minimal sketch for each supported FQBN during the image build:

```text
esp32:esp32:esp32
esp32:esp32:esp32s2
esp32:esp32:esp32s3
esp32:esp32:esp32s3:FlashMode=qio,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi
esp32:esp32:esp32c3
esp32:esp32:esp32c6
```

This moves dependency installation and much of the expensive toolchain setup into the image-build stage. The cache is stored at `/opt/arduino/cache` and owned by the unprivileged `node` runtime user.

### Full builds versus fast releases

`buildspec.aws.yml` has two deliberate modes:

1. **Full toolchain build** — set `FULL_TOOLCHAIN_REBUILD=1`. CodeBuild uses `Dockerfile`. Use this for the first image and whenever the Arduino CLI version, ESP32 core, system packages, bundled libraries, or warm-target list changes.
2. **Fast runtime build** — leave `FULL_TOOLCHAIN_REBUILD` unset or `0`. CodeBuild uses `Dockerfile.runtime`, with ECR `latest` as `BASE_IMAGE`, and replaces only the server application layer. Use this for normal API-only releases.

The first build must be a full build because `Dockerfile.runtime` requires an existing `latest` toolchain image.

CodeBuild tags the image with `CODEBUILD_RESOLVED_SOURCE_VERSION` and with `latest`, then pushes both tags to ECR.

## Runtime configuration on ECS

`infra/aws-service.yml` defines one always-warm ECS Express service:

- Service name: `makeable-esp32-api`.
- Container port: `10000`.
- Health check: `GET /api/health`.
- CPU: `1024` units.
- Memory: `2048` MiB.
- Minimum tasks: `1`.
- Maximum tasks: `1`.
- CloudWatch log group: `/ecs/makeable-esp32-api`.
- Log retention: `14` days.
- Allowed browser origins: the production site, `www`, and the configured Netlify test site.
- OpenAI and Deepgram keys: injected from Secrets Manager, not stored in the repository or plain environment configuration.

The compiler-specific runtime limits are intentionally conservative:

```text
MAX_CONCURRENT_COMPILES=1
ARDUINO_COMPILE_JOBS=1
COMPILE_TIMEOUT_MS=300000
```

The Docker image also runs the application as the non-root `node` user.

## Reproducible deployment sequence

The commands below show the stack order. Replace placeholders with values from the target AWS account. Do not place secret values in the repository or shell history; create the Secrets Manager entries through an approved secure process and pass only their ARNs to CloudFormation.

### 1. Deploy Cognito, DynamoDB, and the task role

```bash
aws cloudformation deploy \
  --stack-name makeable-auth \
  --template-file infra/aws-auth.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides CognitoDomainPrefix=<globally-unique-prefix>
```

Record these stack outputs for the service deployment:

```text
UserPoolId
WebClientId
HostedLoginDomain
TaskRoleArn
```

### 2. Deploy ECR, CodeBuild, and ECS access roles

The template's repository URL default is historical. Override it with the real GitHub repository and the branch that AWS should build:

```bash
aws cloudformation deploy \
  --stack-name makeable-compiler-bootstrap \
  --template-file infra/aws-bootstrap.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    RepositoryUrl=https://github.com/Makeable-inc/Makeable.build.git \
    RepositoryBranch=<deployment-branch>
```

Record:

```text
EcrRepositoryUri
BuildProjectName
EcsTaskExecutionRoleArn
EcsExpressInfrastructureRoleArn
```

### 3. Run the first full toolchain build

```bash
aws codebuild start-build \
  --project-name makeable-esp32-image \
  --environment-variables-override \
    name=FULL_TOOLCHAIN_REBUILD,value=1,type=PLAINTEXT
```

Wait for the build to succeed and confirm that ECR contains both the resolved-source tag and `latest`.

### 4. Deploy the ECS service

Supply the ECR image identifier, the three IAM role ARNs, the two provider-secret ARNs, and Cognito outputs:

```bash
aws cloudformation deploy \
  --stack-name makeable-esp32-service \
  --template-file infra/aws-service.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    ImageIdentifier=<ecr-repository-uri>:latest \
    ExecutionRoleArn=<ecs-task-execution-role-arn> \
    InfrastructureRoleArn=<ecs-express-infrastructure-role-arn> \
    TaskRoleArn=<makeable-ecs-task-role-arn> \
    OpenAISecretArn=<openai-secret-arn> \
    DeepgramSecretArn=<deepgram-secret-arn> \
    CognitoUserPoolId=<user-pool-id> \
    CognitoClientId=<web-client-id> \
    CognitoDomain=<hosted-login-domain>
```

The service stack outputs `ServiceUrl`. The production setup may place CloudFront in front of that origin. Configure Netlify's `MAKEABLE_API_BASE_URL` with the public API origin used by the browser.

### 5. Use fast builds for API-only changes

After a valid `latest` toolchain image exists:

```bash
aws codebuild start-build --project-name makeable-esp32-image
```

This follows the `Dockerfile.runtime` path. Redeploy or update the service to the new immutable source tag when using tag-pinned releases; `latest` is convenient for the initial workflow but an immutable tag provides clearer rollback and audit history.

## What happens when the user clicks “Load to my ESP32”

### 1. The frontend checks compiler readiness

`src/makeable/screens.js` calls `GET /api/esp32/status`. The server runs:

```text
arduino-cli version
arduino-cli core list
```

The UI enables loading only when Arduino CLI is available and the `esp32:esp32` core is installed.

### 2. The browser requests a local serial port

`compileAndFlashFirmware()` in `src/makeable/actions.js` requires `navigator.serial.requestPort`. It supplies filters for common ESP32 USB connections:

```text
0x10c4  Silicon Labs CP210x
0x1a86  WCH CH34x
0x0403  FTDI
0x303a  Espressif native USB
```

The user must choose a device in the browser's native permission prompt. Web Serial is the browser boundary that gives the website access to that selected local device. Chrome's official guide describes `navigator.serial.requestPort()` and the user-selection permission model: <https://developer.chrome.com/docs/capabilities/serial>.

### 3. The browser sends the sketch to AWS

The browser sends an authenticated request:

```http
POST /api/firmware/compile
Authorization: Bearer <Cognito access token>
Content-Type: application/json

{
  "sketch": "<complete Arduino sketch>",
  "fqbn": "<supported ESP32 profile>"
}
```

The API client adds the Cognito bearer token for protected firmware routes. `server.mjs` rejects the compile request if the user is not authenticated.

### 4. The server validates and compiles in an isolated workspace

The current server enforces:

- Maximum JSON request body: `512 KiB`.
- Maximum sketch source: `96 KiB`.
- Board selection from `lib/board-profiles.mjs`; arbitrary FQBN strings are rejected.
- A process-level concurrency limit.
- A compile timeout.
- A unique build root under `.makeable/builds/<UUID>`.
- Cleanup of that entire build root in a `finally` block after success or failure.

For a valid request, it creates:

```text
.makeable/builds/<UUID>/MakeableSketch/MakeableSketch.ino
.makeable/builds/<UUID>/out/
```

Then it runs the equivalent of:

```bash
arduino-cli compile \
  --jobs "$ARDUINO_COMPILE_JOBS" \
  --fqbn "$FQBN" \
  --build-path <unique-output-directory> \
  <unique-sketch-directory>
```

Compiler errors are path-sanitized and limited to the last 4,000 characters before being returned. The browser may make one structured firmware-repair attempt after a compiler HTTP 500, validate the repaired sketch's diagnostic contract, and compile again.

### 5. The server builds the flash manifest

`server.mjs` walks the Arduino output directory and prefers Arduino's generated `flash_args` file. Each accepted line provides a hexadecimal address and a local `.bin` filename. The parser rejects unsafe filenames, invalid addresses, duplicate addresses, or incomplete manifests.

When a valid `flash_args` manifest is unavailable, the server falls back to recognized ESP32 artifacts:

- Bootloader.
- Partition table.
- `boot_app0.bin`.
- Application image.

For the classic ESP32 profile, the fallback addresses are:

```text
0x1000   bootloader
0x8000   partition table
0xe000   boot_app0
0x10000  application
```

Other ESP32-family profiles may use different bootloader addresses; the current integration test expects `0x0` for the configured ESP32-S3 N16R8 profile. The client must use the server-provided address for every segment and must not invent an address.

Each returned image has this shape:

```json
{
  "name": "MakeableSketch.ino.bin",
  "label": "Application",
  "address": 65536,
  "size": 123456,
  "dataBase64": "..."
}
```

The server returns sparse segments rather than forcing every response into one full-flash merged image. The current integration test verifies segment addresses, non-empty Base64 data, an allowlisted board profile, compile-error behavior, and rejection of an arbitrary target.

### 6. The browser flashes the ESP32 locally

The browser dynamically loads the vendored `esptool-js` bundle and creates:

```text
Transport(selectedPort, true)
ESPLoader({ transport, baudrate: 115200, ... })
```

It calls `loader.main("default_reset")` to connect to the ESP32 bootloader and identify the board. It then converts each `dataBase64` value to a binary string and calls `loader.writeFlash()` with the server-provided address:

```javascript
fileArray: images.map((image) => ({
  data: base64ToBinaryString(image.dataBase64),
  address: image.address,
}))
```

The current write options are:

```text
flashMode: keep
flashFreq: keep
flashSize: keep
eraseAll: false in the UI flow
compress: true
```

`esptool-js` is Espressif's JavaScript serial flasher and exposes `writeFlash()` for writing file images to specified addresses: <https://espressif.github.io/esptool-js/docs/index.html>.

The frontend weights progress by segment size, so progress increases across the complete multi-image operation instead of restarting at zero for every segment. When flashing finishes, it calls `loader.after("hard_reset")`, reports 100%, disconnects the transport, records the successful board and FQBN, and advances to automatic hardware testing.

If the user cancels while a hardware operation is active, the code disconnects the transport so the in-progress operation terminates. The UI does not record success unless flashing actually completes.

## Security and reliability controls

### Implemented controls

- Cognito authentication protects `POST /api/firmware/compile`.
- Only known ESP32-family profiles are accepted.
- Request, sketch, compiler-output, time, and concurrency limits are enforced.
- Each compile uses a UUID workspace and always deletes it.
- Secrets come from AWS Secrets Manager.
- The service runs as a non-root user.
- CORS accepts configured Makeable origins and loopback development origins.
- Web Serial requires explicit user selection of a local device.
- Flash addresses come from validated compiler artifacts, not from the browser.
- The normal browser flow does not erase the whole chip.
- Flash cancellation disconnects the transport and does not mark the board successful.

### Operational caveats for interns

- Do not say “AWS flashes the USB device.” AWS compiles; the browser flashes.
- Do not accept arbitrary FQBNs or arbitrary filesystem paths from the client.
- Do not expose raw provider secrets, AWS credentials, or a Secrets Manager value to the frontend.
- Do not remove the temporary-workspace cleanup.
- Do not change Arduino CLI, the ESP32 core, libraries, or warm targets through a fast runtime-only build. Use a full toolchain rebuild.
- Do not assume every ESP32-family bootloader starts at `0x1000`; use the returned manifest address.
- Do not mark firmware as installed before `writeFlash()` and the final reset complete.
- Physical flashing still requires a supported desktop browser, a data-capable USB cable, a compatible ESP32, and the user's permission.

## Verification checklist

### Repository checks

```bash
npm run build
npm test
```

The Arduino integration test runs only when a real local toolchain path is provided:

```bash
npm run toolchain:install
npm run test:compiler
```

That test starts `server.mjs`, checks `/api/esp32/status`, compiles a classic ESP32 sketch, compiles the N16R8 ESP32-S3 profile, verifies sparse addresses and payloads, checks a real compiler failure, and confirms that an arbitrary board profile returns HTTP 400.

### AWS smoke checks

1. `GET /api/health` returns HTTP 200.
2. `GET /api/esp32/status` reports Arduino CLI and the ESP32 core.
3. An unauthenticated `POST /api/firmware/compile` is rejected.
4. An authenticated minimal allowlisted sketch returns non-empty images with addresses and Base64 data.
5. An arbitrary FQBN is rejected.
6. CloudWatch shows the compile without leaking source paths or secrets.
7. The `.makeable/builds/<UUID>` workspace is deleted after success and after failure.
8. A real supported ESP32 can be selected in Chrome or Edge and flashed through the full Makeable UI.
9. Cancel during flashing and verify that no success state is recorded.
10. Unplug or choose the wrong device and verify that the UI fails safely.

## Troubleshooting

### “Hosted firmware compiler is temporarily unavailable”

Check `ARDUINO_CLI_PATH`, execute `arduino-cli version`, execute `arduino-cli core list`, and confirm that `esp32:esp32` is installed in the container's configured Arduino data directory.

### HTTP 429: compiler busy

The current production configuration allows one active compile. The server returns `Retry-After: 5`. Retry after the current build finishes; do not raise concurrency without load-testing memory and CPU behavior.

### Compile succeeds but no flashable images are returned

Inspect the Arduino output directory and `flash_args`. Confirm that the installed ESP32 core still emits the expected artifacts and that any parser change preserves filename, address, and duplicate-address validation.

### Browser cannot see the board

Use a desktop browser with Web Serial, use a data-capable USB cable, install any required OS USB-serial driver, and confirm that the device's USB vendor is covered by the current filters. The user must select the board in the browser prompt.

### Flash connects but fails partway through

Try another cable or port, close other serial monitors, keep the board powered, and retry. The code compresses writes and disconnects the transport on cancellation or failure.

## Source map

| File | Facts verified from this file |
| --- | --- |
| `Dockerfile` | Toolchain versions, libraries, warm targets, paths, user, and compiler limits. |
| `Dockerfile.runtime` | Fast application-only image overlay. |
| `buildspec.aws.yml` | ECR login, full/fast build selection, image tags, and pushes. |
| `infra/aws-bootstrap.yml` | ECR, CodeBuild, execution role, infrastructure role, and source branch configuration. |
| `infra/aws-service.yml` | ECS Express service, port, health check, resources, logs, scaling, origins, secrets, and runtime environment. |
| `infra/aws-auth.yml` | Cognito, DynamoDB, and ECS task role. |
| `server.mjs` | Authentication, limits, status endpoint, compile command, manifest extraction, Base64 response, and cleanup. |
| `lib/board-profiles.mjs` | Supported ESP32 profiles, FQBN allowlist, USB guidance, and profile flash metadata. |
| `netlify/functions/api.mjs` | Public API-base configuration and same-origin proxy behavior. |
| `src/makeable/api-client.js` | API base selection and Cognito authorization header. |
| `src/makeable/screens.js` | User workflow, readiness UI, progress UI, cancellation, and persisted flash state. |
| `src/makeable/actions.js` | Web Serial selection, hosted compile request, optional repair, Base64 decoding, `esptool-js` write, reset, progress, and cancellation. |
| `tests/compiler.integration.test.mjs` | Real Arduino CLI integration expectations and blocked arbitrary target. |
| `tests/unit/task4-actions.test.js` | Browser compile/flash behavior with a simulated serial transport. |
| `tests/unit/task4-corrections.test.js` | Cancellation and aggregate multi-segment progress. |

## External primary references

- AWS CloudFormation, `AWS::ECS::ExpressGatewayService`: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-expressgatewayservice.html>
- Arduino CLI getting started and compile usage: <https://arduino.github.io/arduino-cli/latest/getting-started/>
- Chrome Web Serial guide: <https://developer.chrome.com/docs/capabilities/serial>
- Espressif `esptool-js`: <https://espressif.github.io/esptool-js/docs/index.html>
