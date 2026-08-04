#pragma once

#include <Arduino.h>

namespace BurnerProtocol {

constexpr uint8_t kVersion = 2;
constexpr uint16_t kWidth = 320;
constexpr uint16_t kHeight = 240;
constexpr uint32_t kPixelCount = static_cast<uint32_t>(kWidth) * kHeight;
constexpr uint32_t kFrameBytes = kPixelCount * 2;
constexpr size_t kHeaderBytes = 12;
constexpr size_t kCrcBytes = 4;
constexpr size_t kMaximumPacketBytes = 20 * 1024;

enum PacketType : uint8_t {
  Hello = 1,
  HelloAck = 2,
  Keyframe = 3,
  Delta = 4,
  Heartbeat = 5,
  Ack = 6,
  Nack = 7,
  Status = 8,
  GifBegin = 9,
  GifChunk = 10,
  GifCommit = 11,
  HudUpdate = 12,
};

enum StatusCode : uint8_t {
  Streaming = 0,
  WaitingForClaude = 1,
  NoConnection = 2,
};

enum ErrorCode : uint8_t {
  Okay = 0,
  BadVersion = 1,
  BadLength = 2,
  BadCrc = 3,
  BadSequence = 4,
  NeedKeyframe = 5,
  BadPayload = 6,
  GifAlreadyLoaded = 7,
};

inline uint16_t readU16(const uint8_t* bytes) {
  return static_cast<uint16_t>(bytes[0]) | (static_cast<uint16_t>(bytes[1]) << 8);
}

inline uint32_t readU32(const uint8_t* bytes) {
  return static_cast<uint32_t>(bytes[0])
    | (static_cast<uint32_t>(bytes[1]) << 8)
    | (static_cast<uint32_t>(bytes[2]) << 16)
    | (static_cast<uint32_t>(bytes[3]) << 24);
}

inline void writeU32(uint8_t* bytes, uint32_t value) {
  bytes[0] = value & 0xff;
  bytes[1] = (value >> 8) & 0xff;
  bytes[2] = (value >> 16) & 0xff;
  bytes[3] = (value >> 24) & 0xff;
}

uint32_t crc32(const uint8_t* data, size_t length);
size_t cobsDecodeInPlace(uint8_t* data, size_t length);
size_t cobsEncode(const uint8_t* input, size_t length, uint8_t* output, size_t capacity);

}  // namespace BurnerProtocol
