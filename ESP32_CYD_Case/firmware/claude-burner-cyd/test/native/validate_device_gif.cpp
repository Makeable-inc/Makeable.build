#include <cstdint>
#include <cstdio>
#include <sys/stat.h>

#include "AnimatedGIF.h"

namespace {

constexpr int kWidth = 320;
constexpr int kHeight = 240;
constexpr int kExpectedFrames = 96;
constexpr int kExpectedDelayPatternMs[] = {40, 40, 40, 40, 40, 50};
constexpr int kExpectedDelayPatternLength = 6;
constexpr int kExpectedDurationMs = 4000;
constexpr int kMaximumValidationFrames = 512;
constexpr std::size_t kMaximumGifBytes = 550U * 1024U;

FILE* openValidationFile = nullptr;
bool checkingFirstFrame = false;
bool firstFrameOkay = false;
int nextFirstFrameRow = 0;

void* openGifFile(const char* path, int32_t* size) {
  openValidationFile = std::fopen(path, "rb");
  if (!openValidationFile) return nullptr;
  std::fseek(openValidationFile, 0, SEEK_END);
  *size = static_cast<int32_t>(std::ftell(openValidationFile));
  std::fseek(openValidationFile, 0, SEEK_SET);
  return openValidationFile;
}

void closeGifFile(void* handle) {
  if (handle) std::fclose(static_cast<FILE*>(handle));
  openValidationFile = nullptr;
}

int32_t readGifFile(GIFFILE* state, uint8_t* output, int32_t length) {
  FILE* file = static_cast<FILE*>(state->fHandle);
  if (!file || length <= 0) return 0;
  if (state->iSize - state->iPos < length) {
    length = state->iSize - state->iPos - 1;
  }
  if (length <= 0) return 0;
  const int32_t read = static_cast<int32_t>(std::fread(output, 1, length, file));
  state->iPos = static_cast<int32_t>(std::ftell(file));
  return read;
}

int32_t seekGifFile(GIFFILE* state, int32_t position) {
  FILE* file = static_cast<FILE*>(state->fHandle);
  if (!file || std::fseek(file, position, SEEK_SET) != 0) return -1;
  state->iPos = static_cast<int32_t>(std::ftell(file));
  return state->iPos;
}

void discardGifLine(GIFDRAW* draw) {
  if (!checkingFirstFrame || !firstFrameOkay) return;
  if (draw->iX != 0
      || draw->iY != 0
      || draw->iWidth != kWidth
      || draw->iHeight != kHeight
      || draw->iY + draw->y != nextFirstFrameRow) {
    firstFrameOkay = false;
    return;
  }
  ++nextFirstFrameRow;
}

bool validate(const char* path) {
  struct stat fileInfo {};
  if (stat(path, &fileInfo) != 0) {
    std::fprintf(stderr, "%s: cannot stat file\n", path);
    return false;
  }
  if (fileInfo.st_size < 6 || static_cast<std::size_t>(fileInfo.st_size) > kMaximumGifBytes) {
    std::fprintf(stderr, "%s: size %lld is outside 6..%zu bytes\n",
                 path, static_cast<long long>(fileInfo.st_size), kMaximumGifBytes);
    return false;
  }

  AnimatedGIF gif;
  gif.begin(GIF_PALETTE_RGB565_BE);
  if (!gif.open(path, openGifFile, closeGifFile, readGifFile, seekGifFile, discardGifLine)) {
    std::fprintf(stderr, "%s: AnimatedGIF open failed\n", path);
    return false;
  }
  if (gif.getCanvasWidth() != kWidth || gif.getCanvasHeight() != kHeight) {
    std::fprintf(stderr, "%s: canvas is %dx%d, expected %dx%d\n",
                 path, gif.getCanvasWidth(), gif.getCanvasHeight(), kWidth, kHeight);
    gif.close();
    return false;
  }
  if (gif.getLoopCount() != 0) {
    std::fprintf(stderr, "%s: loop count is %d, expected infinite (0)\n", path, gif.getLoopCount());
    gif.close();
    return false;
  }

  int decodedFrames = 0;
  int decodedDurationMs = 0;
  bool timingOkay = true;
  bool valid = true;
  while (true) {
    checkingFirstFrame = decodedFrames == 0;
    if (checkingFirstFrame) {
      firstFrameOkay = true;
      nextFirstFrameRow = 0;
    }
    int frameDelayMs = 0;
    const int result = gif.playFrame(false, &frameDelayMs);
    const int error = gif.getLastError();
    if (result < 0 || (error != GIF_SUCCESS && error != GIF_EMPTY_FRAME)) {
      std::fprintf(stderr, "%s: decode failed at frame %d (error %d)\n", path, decodedFrames, error);
      valid = false;
      break;
    }
    if (checkingFirstFrame && (!firstFrameOkay || nextFirstFrameRow != kHeight)) {
      std::fprintf(stderr, "%s: frame zero is not a full-canvas top-to-bottom keyframe\n", path);
      valid = false;
      break;
    }
    if (error == GIF_SUCCESS) {
      const int expectedDelay =
          kExpectedDelayPatternMs[decodedFrames % kExpectedDelayPatternLength];
      if (frameDelayMs != expectedDelay) timingOkay = false;
      decodedDurationMs += frameDelayMs;
      ++decodedFrames;
    }
    if (result == 0) break;
    if (decodedFrames >= kMaximumValidationFrames) {
      std::fprintf(stderr, "%s: exceeds %d-frame decoder validation bound\n",
                   path, kMaximumValidationFrames);
      valid = false;
      break;
    }
  }
  checkingFirstFrame = false;
  gif.close();

  if (valid && decodedFrames != kExpectedFrames) {
    std::fprintf(stderr, "%s: decoded %d frames, expected %d\n",
                 path, decodedFrames, kExpectedFrames);
    valid = false;
  }
  if (valid && (!timingOkay || decodedDurationMs != kExpectedDurationMs)) {
    std::fprintf(stderr,
                 "%s: expected repeating 40/40/40/40/40/50 ms timing totaling %d ms; decoded %d ms\n",
                 path, kExpectedDurationMs, decodedDurationMs);
    valid = false;
  }
  if (valid) {
    std::printf("PASS %s (%lld bytes, %d frames, %d ms, exact 24 FPS)\n",
                path, static_cast<long long>(fileInfo.st_size), decodedFrames, decodedDurationMs);
  }
  return valid;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: validate-device-gif GIF [GIF ...]\n");
    return 64;
  }
  bool valid = true;
  for (int index = 1; index < argc; ++index) valid = validate(argv[index]) && valid;
  return valid ? 0 : 1;
}
