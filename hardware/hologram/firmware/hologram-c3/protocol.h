#pragma once

#include <Arduino.h>

namespace HologramProtocol {

constexpr uint8_t VERSION = 1;
constexpr uint16_t WIDTH = 128;
constexpr uint16_t HEIGHT = 128;
constexpr uint16_t FRAME_BYTES = WIDTH * HEIGHT / 8;
constexpr uint16_t MAX_CHUNK_BYTES = 160;

constexpr const char* SERVICE_UUID = "3f7c1000-6a1b-4ef3-8a42-1b6d0a7c9e10";
constexpr const char* RX_UUID = "3f7c1001-6a1b-4ef3-8a42-1b6d0a7c9e10";
constexpr const char* TX_UUID = "3f7c1002-6a1b-4ef3-8a42-1b6d0a7c9e10";

enum Command : uint8_t {
  PING = 0x01,
  FRAME_BEGIN = 0x10,
  FRAME_CHUNK = 0x11,
  FRAME_COMMIT = 0x12,
  CLEAR = 0x20,
  BRIGHTNESS = 0x21,
};

enum Event : uint8_t {
  READY = 0x80,
  ACK = 0x81,
};

enum Status : uint8_t {
  OK = 0,
  BAD_PACKET = 1,
  BAD_SEQUENCE = 2,
  BAD_LENGTH = 3,
  BAD_CRC = 4,
  BUSY = 5,
};

inline uint16_t readU16(const uint8_t* data) {
  return static_cast<uint16_t>(data[0]) |
         (static_cast<uint16_t>(data[1]) << 8);
}

inline uint32_t readU32(const uint8_t* data) {
  return static_cast<uint32_t>(data[0]) |
         (static_cast<uint32_t>(data[1]) << 8) |
         (static_cast<uint32_t>(data[2]) << 16) |
         (static_cast<uint32_t>(data[3]) << 24);
}

inline uint32_t crc32(const uint8_t* data, size_t length) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t index = 0; index < length; ++index) {
    crc ^= data[index];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
  }
  return crc ^ 0xFFFFFFFFu;
}

}  // namespace HologramProtocol

