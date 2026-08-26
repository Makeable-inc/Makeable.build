#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <NimBLEDevice.h>

#include "protocol.h"

using namespace HologramProtocol;

#ifndef HOLOGRAM_SDA_PIN
#define HOLOGRAM_SDA_PIN 8
#endif

#ifndef HOLOGRAM_SCL_PIN
#define HOLOGRAM_SCL_PIN 9
#endif

#ifndef HOLOGRAM_I2C_HZ
#define HOLOGRAM_I2C_HZ 400000
#endif

constexpr int OLED_RESET_PIN = -1;
constexpr char DEVICE_NAME[] = "Makeable Hologram";

Adafruit_SH1107 display(WIDTH, HEIGHT, &Wire, OLED_RESET_PIN, HOLOGRAM_I2C_HZ, 100000);
NimBLECharacteristic* txCharacteristic = nullptr;

uint8_t stagingFrame[FRAME_BYTES] = {};
volatile uint16_t receivingSequence = 0;
volatile uint16_t receivedBytes = 0;
volatile uint32_t expectedCrc = 0;
volatile uint16_t requestedHoldMs = 100;
volatile bool receivingFrame = false;
volatile bool framePending = false;
volatile bool clearPending = false;
volatile bool brightnessPending = false;
volatile bool restartAdvertising = false;
volatile uint8_t pendingBrightness = 0xB8;
volatile uint16_t pendingFrameSequence = 0;
volatile uint16_t pendingClearSequence = 0;
volatile uint16_t pendingBrightnessSequence = 0;
portMUX_TYPE frameMux = portMUX_INITIALIZER_UNLOCKED;

bool probeI2cAddress(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void notifyReady() {
  if (!txCharacteristic) return;
  uint8_t payload[8] = {
    Event::READY,
    VERSION,
    static_cast<uint8_t>(WIDTH),
    static_cast<uint8_t>(HEIGHT),
    static_cast<uint8_t>(FRAME_BYTES & 0xFF),
    static_cast<uint8_t>((FRAME_BYTES >> 8) & 0xFF),
    static_cast<uint8_t>(MAX_CHUNK_BYTES & 0xFF),
    static_cast<uint8_t>((MAX_CHUNK_BYTES >> 8) & 0xFF),
  };
  txCharacteristic->setValue(payload, sizeof(payload));
  txCharacteristic->notify();
}

void notifyAck(uint8_t command, uint16_t sequence, Status status, uint8_t renderMs = 0) {
  if (!txCharacteristic) return;
  uint8_t payload[6] = {
    Event::ACK,
    command,
    static_cast<uint8_t>(sequence & 0xFF),
    static_cast<uint8_t>((sequence >> 8) & 0xFF),
    static_cast<uint8_t>(status),
    renderMs,
  };
  txCharacteristic->setValue(payload, sizeof(payload));
  txCharacteristic->notify();
}

void reject(uint8_t command, uint16_t sequence, Status status) {
  notifyAck(command, sequence, status);
}

class HologramServerCallbacks final : public NimBLEServerCallbacks {
 public:
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    Serial.println("BLE controller connected");
  }

  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    portENTER_CRITICAL(&frameMux);
    receivingFrame = false;
    receivedBytes = 0;
    restartAdvertising = true;
    portEXIT_CRITICAL(&frameMux);
    Serial.println("BLE controller disconnected");
  }
};

class HologramRxCallbacks final : public NimBLECharacteristicCallbacks {
 public:
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) override {
    std::string value = characteristic->getValue();
    const auto* data = reinterpret_cast<const uint8_t*>(value.data());
    const size_t length = value.size();
    if (length < 1) return;

    const uint8_t command = data[0];
    if (command == Command::PING) {
      notifyReady();
      return;
    }

    if (length < 3) {
      reject(command, 0, Status::BAD_PACKET);
      return;
    }
    const uint16_t sequence = readU16(data + 1);

    if (command == Command::FRAME_BEGIN) {
      if (length != 11) {
        reject(command, sequence, Status::BAD_PACKET);
        return;
      }
      const uint16_t frameLength = readU16(data + 3);
      if (frameLength != FRAME_BYTES) {
        reject(command, sequence, Status::BAD_LENGTH);
        return;
      }
      if (framePending || clearPending) {
        reject(command, sequence, Status::BUSY);
        return;
      }
      portENTER_CRITICAL(&frameMux);
      receivingSequence = sequence;
      receivedBytes = 0;
      requestedHoldMs = readU16(data + 5);
      expectedCrc = readU32(data + 7);
      receivingFrame = true;
      portEXIT_CRITICAL(&frameMux);
      return;
    }

    if (command == Command::FRAME_CHUNK) {
      if (length < 6 || !receivingFrame) {
        reject(command, sequence, Status::BAD_PACKET);
        return;
      }
      const uint16_t offset = readU16(data + 3);
      const size_t chunkLength = length - 5;
      if (sequence != receivingSequence) {
        reject(command, sequence, Status::BAD_SEQUENCE);
        return;
      }
      if (offset != receivedBytes || chunkLength > MAX_CHUNK_BYTES || offset + chunkLength > FRAME_BYTES) {
        receivingFrame = false;
        reject(command, sequence, Status::BAD_LENGTH);
        return;
      }
      memcpy(stagingFrame + offset, data + 5, chunkLength);
      receivedBytes += chunkLength;
      return;
    }

    if (command == Command::FRAME_COMMIT) {
      if (!receivingFrame || sequence != receivingSequence) {
        reject(command, sequence, Status::BAD_SEQUENCE);
        return;
      }
      if (receivedBytes != FRAME_BYTES) {
        receivingFrame = false;
        reject(command, sequence, Status::BAD_LENGTH);
        return;
      }
      if (crc32(stagingFrame, FRAME_BYTES) != expectedCrc) {
        receivingFrame = false;
        reject(command, sequence, Status::BAD_CRC);
        return;
      }
      portENTER_CRITICAL(&frameMux);
      receivingFrame = false;
      pendingFrameSequence = sequence;
      framePending = true;
      portEXIT_CRITICAL(&frameMux);
      return;
    }

    if (command == Command::CLEAR) {
      if (framePending || clearPending) {
        reject(command, sequence, Status::BUSY);
        return;
      }
      portENTER_CRITICAL(&frameMux);
      pendingClearSequence = sequence;
      clearPending = true;
      portEXIT_CRITICAL(&frameMux);
      return;
    }

    if (command == Command::BRIGHTNESS) {
      if (length != 4) {
        reject(command, sequence, Status::BAD_PACKET);
        return;
      }
      portENTER_CRITICAL(&frameMux);
      pendingBrightness = data[3];
      pendingBrightnessSequence = sequence;
      brightnessPending = true;
      portEXIT_CRITICAL(&frameMux);
      return;
    }

    reject(command, sequence, Status::BAD_PACKET);
  }
};

void drawBootScreen() {
  display.clearDisplay();
  display.drawRect(7, 7, 114, 114, SH110X_WHITE);
  display.drawRect(12, 12, 104, 104, SH110X_WHITE);
  display.setTextColor(SH110X_WHITE);
  display.setTextWrap(false);
  display.setTextSize(2);
  display.setCursor(16, 37);
  display.print("HOLOGRAM");
  display.setTextSize(1);
  display.setCursor(34, 72);
  display.print("BLE READY");
  display.fillCircle(64, 94, 3, SH110X_WHITE);
  display.display();
}

void startBle() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setMTU(185);

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new HologramServerCallbacks());
  NimBLEService* service = server->createService(SERVICE_UUID);
  txCharacteristic = service->createCharacteristic(
    TX_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
  );
  NimBLECharacteristic* rxCharacteristic = service->createCharacteristic(
    RX_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  rxCharacteristic->setCallbacks(new HologramRxCallbacks());
  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setName(DEVICE_NAME);
  advertising->start();
  Serial.printf("Advertising as %s\n", DEVICE_NAME);
}

void setup() {
  Serial.begin(115200);
  delay(150);
  Wire.begin(HOLOGRAM_SDA_PIN, HOLOGRAM_SCL_PIN);
  Wire.setClock(HOLOGRAM_I2C_HZ);

  uint8_t oledAddress = 0;
  if (probeI2cAddress(0x3C)) oledAddress = 0x3C;
  else if (probeI2cAddress(0x3D)) oledAddress = 0x3D;
  if (!oledAddress || !display.begin(oledAddress, true)) {
    Serial.println("SH1107 OLED not found at 0x3C or 0x3D");
    pinMode(LED_BUILTIN, OUTPUT);
    while (true) {
      digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
      delay(180);
    }
  }

  display.setContrast(pendingBrightness);
  drawBootScreen();
  startBle();
}

void loop() {
  if (restartAdvertising) {
    portENTER_CRITICAL(&frameMux);
    restartAdvertising = false;
    portEXIT_CRITICAL(&frameMux);
    NimBLEDevice::getAdvertising()->start();
  }

  if (framePending) {
    const uint32_t startedAt = millis();
    const uint16_t sequence = pendingFrameSequence;
    // Direct buffer writes bypass Adafruit_GrayOLED's dirty-window tracking.
    // clearDisplay() marks the complete panel dirty before the received frame
    // replaces the cleared bytes, ensuring display() transfers every page.
    display.clearDisplay();
    memcpy(display.getBuffer(), stagingFrame, FRAME_BYTES);
    display.display();
    const uint8_t renderMs = static_cast<uint8_t>(min<uint32_t>(255, millis() - startedAt));
    portENTER_CRITICAL(&frameMux);
    framePending = false;
    portEXIT_CRITICAL(&frameMux);
    notifyAck(Command::FRAME_COMMIT, sequence, Status::OK, renderMs);
  }

  if (clearPending) {
    const uint16_t sequence = pendingClearSequence;
    const uint32_t startedAt = millis();
    display.clearDisplay();
    display.display();
    const uint8_t renderMs = static_cast<uint8_t>(min<uint32_t>(255, millis() - startedAt));
    portENTER_CRITICAL(&frameMux);
    clearPending = false;
    portEXIT_CRITICAL(&frameMux);
    notifyAck(Command::CLEAR, sequence, Status::OK, renderMs);
  }

  if (brightnessPending) {
    const uint16_t sequence = pendingBrightnessSequence;
    display.setContrast(pendingBrightness);
    portENTER_CRITICAL(&frameMux);
    brightnessPending = false;
    portEXIT_CRITICAL(&frameMux);
    notifyAck(Command::BRIGHTNESS, sequence, Status::OK);
  }

  delay(1);
}
