#include "protocol.h"

namespace BurnerProtocol {

uint32_t crc32(const uint8_t* data, size_t length) {
  uint32_t crc = 0xffffffff;
  for (size_t index = 0; index < length; ++index) {
    crc ^= data[index];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xedb88320 : crc >> 1;
    }
  }
  return crc ^ 0xffffffff;
}

size_t cobsDecodeInPlace(uint8_t* data, size_t length) {
  size_t readIndex = 0;
  size_t writeIndex = 0;
  while (readIndex < length) {
    const uint8_t code = data[readIndex++];
    if (code == 0) return 0;
    const size_t end = readIndex + code - 1;
    if (end > length) return 0;
    while (readIndex < end) data[writeIndex++] = data[readIndex++];
    if (code != 0xff && readIndex < length) data[writeIndex++] = 0;
  }
  return writeIndex;
}

size_t cobsEncode(const uint8_t* input, size_t length, uint8_t* output, size_t capacity) {
  if (capacity < length + length / 254 + 2) return 0;
  size_t readIndex = 0;
  size_t writeIndex = 1;
  size_t codeIndex = 0;
  uint8_t code = 1;
  while (readIndex < length) {
    if (input[readIndex] == 0) {
      output[codeIndex] = code;
      codeIndex = writeIndex++;
      code = 1;
      ++readIndex;
    } else {
      output[writeIndex++] = input[readIndex++];
      ++code;
      if (code == 0xff) {
        output[codeIndex] = code;
        codeIndex = writeIndex++;
        code = 1;
      }
    }
  }
  output[codeIndex] = code;
  return writeIndex;
}

}  // namespace BurnerProtocol
