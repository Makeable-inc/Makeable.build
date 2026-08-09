#include <Arduino.h>
#include <AnimatedGIF.h>
#include <LittleFS.h>
#include <TFT_eSPI.h>
#include "deferred_commit.h"
#include "fallback_scene.h"
#include "link_recovery.h"
#include "protocol.h"

using namespace BurnerProtocol;

namespace {

constexpr uint32_t kSerialBaud = 2000000;
constexpr uint32_t kConnectionTimeoutMs = 1500;
constexpr uint8_t kBacklightPin = 21;
constexpr uint32_t kMaximumGifBytes = 550UL * 1024UL;
constexpr uint16_t kMaximumValidationFrames = 512;
constexpr char kActiveGifPath[] = "/active.gif";
constexpr char kActiveGifMetadataPath[] = "/active.meta";
constexpr char kIncomingGifPath[] = "/incoming.gif";
constexpr char kIncomingGifMetadataPath[] = "/incoming.meta";
constexpr char kRollbackGifPath[] = "/rollback.gif";
constexpr char kRollbackGifMetadataPath[] = "/rollback.meta";
constexpr int16_t kHudX = 8;
constexpr int16_t kHudY = 8;
constexpr int16_t kHudWidth = 120;
constexpr int16_t kHudHeight = 27;
constexpr int16_t kHudRight = kHudX + kHudWidth;
constexpr int16_t kHudBottom = kHudY + kHudHeight;
// Cache the distant volcano/smoke boundary. The GIF's first frame is a full
// keyframe on every loop; without comparison it needlessly rewrites this thin,
// high-contrast edge while the ILI9341 is scanning it. Twenty KiB is enough to
// suppress identical summit pixels without the RAM cost of a full framebuffer.
constexpr int16_t kSummitCacheX = 96;
constexpr int16_t kSummitCacheY = 0;
constexpr int16_t kSummitCacheWidth = 128;
constexpr int16_t kSummitCacheHeight = 80;
constexpr int16_t kSummitCacheRight = kSummitCacheX + kSummitCacheWidth;
constexpr int16_t kSummitCacheBottom = kSummitCacheY + kSummitCacheHeight;
constexpr int16_t kOfflineLabelCenterX = 160;
constexpr int16_t kOfflineLabelCenterY = 57;

TFT_eSPI display;
AnimatedGIF gif;
AnimatedGIF gifValidator;
File gifReadFile;
File gifValidationFile;
File gifUploadFile;
uint16_t gifLineBuffer[kWidth];
uint16_t summitCache[kSummitCacheWidth * kSummitCacheHeight];
bool summitCacheReady = false;
uint8_t* packetBuffer = nullptr;
size_t packetLength = 0;
uint32_t lastPacketAt = 0;
uint32_t lastSequence = 0;
uint8_t lastAcknowledgementCode = Okay;
uint8_t lastAcknowledgementType = Ack;
bool sequenceStarted = false;
bool fileSystemReady = false;
bool gifPlaying = false;
bool gifUploadInProgress = false;
bool gifPromotionPending = false;
DeferredCommitAcknowledgement deferredGifCommit;
LinkRecoveryState linkRecoveryState;
bool gifValidationCheckingFirstFrame = false;
bool gifValidationFirstFrameOkay = false;
uint16_t gifValidationNextRow = 0;
uint32_t gifUploadExpectedBytes = 0;
uint32_t gifUploadExpectedCrc = 0;
uint32_t gifUploadReceivedBytes = 0;
uint32_t gifUploadRunningCrc = 0xffffffff;
uint32_t nextGifFrameAtMicros = 0;
uint32_t gifFramesPlayed = 0;
uint32_t gifLoopsCompleted = 0;
uint32_t lastGifRenderMicros = 0;
// Diagnostic: how many discrete address-window pushes the last frame cost, and
// how long was spent inside them. 80MHz only bought 12% over 40MHz, so the cost
// is CPU-side, not pixel bandwidth — this splits draw from decode.
uint32_t gifRunsLastFrame = 0;
uint32_t gifRunsInProgress = 0;
uint32_t gifPushMicrosLastFrame = 0;
uint32_t gifPushMicrosInProgress = 0;
bool haveKeyframe = false;
bool keyframeInProgress = false;
uint32_t nextKeyframePixel = 0;
bool fallbackVisible = false;
bool waitingVisible = false;
uint8_t currentLife = 0;
uint8_t currentLevel = 1;
uint8_t lastHudLife = 255;
uint8_t lastHudLevel = 0;

void drawHud(uint8_t life, uint8_t level);
void playGifFrameIfDue();
void sendAcknowledgement(uint8_t type, uint32_t acknowledgedSequence, uint8_t code);
bool computeFileCrc(const char* path, uint32_t expectedBytes, uint32_t& checksum);

uint32_t updateCrc32(uint32_t crc, const uint8_t* data, size_t length) {
  while (length--) {
    crc ^= *data++;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc >> 1) ^ (0xedb88320UL & (0U - (crc & 1U)));
    }
  }
  return crc;
}

void* openGifFile(const char* filename, int32_t* size) {
  gifReadFile = LittleFS.open(filename, FILE_READ);
  if (!gifReadFile) return nullptr;
  *size = static_cast<int32_t>(gifReadFile.size());
  return &gifReadFile;
}

void* openGifValidationFile(const char* filename, int32_t* size) {
  gifValidationFile = LittleFS.open(filename, FILE_READ);
  if (!gifValidationFile) return nullptr;
  *size = static_cast<int32_t>(gifValidationFile.size());
  return &gifValidationFile;
}

void closeGifFile(void* handle) {
  File* file = static_cast<File*>(handle);
  if (file) file->close();
}

int32_t readGifFile(GIFFILE* fileState, uint8_t* output, int32_t length) {
  File* file = static_cast<File*>(fileState->fHandle);
  if (!file || !*file || length <= 0) return 0;
  if (fileState->iSize - fileState->iPos < length) {
    length = fileState->iSize - fileState->iPos - 1;
  }
  if (length <= 0) return 0;
  const int32_t read = static_cast<int32_t>(file->read(output, length));
  fileState->iPos = static_cast<int32_t>(file->position());
  return read;
}

int32_t seekGifFile(GIFFILE* fileState, int32_t position) {
  File* file = static_cast<File*>(fileState->fHandle);
  if (!file || !*file || !file->seek(position)) return -1;
  fileState->iPos = static_cast<int32_t>(file->position());
  return fileState->iPos;
}

void discardGifLine(GIFDRAW* draw) {
  if (!gifValidationCheckingFirstFrame || !gifValidationFirstFrameOkay) return;
  const int canvasY = draw->iY + draw->y;
  if (draw->iX != 0
      || draw->iY != 0
      || draw->iWidth != kWidth
      || draw->iHeight != kHeight
      || canvasY != gifValidationNextRow) {
    gifValidationFirstFrameOkay = false;
    return;
  }
  ++gifValidationNextRow;
}

void pushGifRunDirectOutsideHud(int x, int y, uint16_t* pixels, int width) {
  if (width < 1) return;
  gifRunsInProgress += 1;
#ifdef BURNER_PROFILE_DRAW
  const uint32_t pushStarted = micros();
#endif
  const int right = x + width;
  if (y < kHudY || y >= kHudBottom || right <= kHudX || x >= kHudRight) {
    display.setAddrWindow(x, y, width, 1);
    display.pushPixels(pixels, width);
  } else {
    // The LIFE HUD is a persistent firmware layer. Split any GIF scanline that
    // crosses it instead of painting underneath and redrawing the HUD afterward.
    // This prevents a one-frame flash at every full frame-zero loop keyframe.
    if (x < kHudX) {
      const int leftWidth = min(width, kHudX - x);
      if (leftWidth > 0) {
        display.setAddrWindow(x, y, leftWidth, 1);
        display.pushPixels(pixels, leftWidth);
      }
    }
    if (right > kHudRight) {
      const int rightX = max(x, static_cast<int>(kHudRight));
      const int offset = rightX - x;
      const int rightWidth = right - rightX;
      if (rightWidth > 0) {
        display.setAddrWindow(rightX, y, rightWidth, 1);
        display.pushPixels(pixels + offset, rightWidth);
      }
    }
  }
#ifdef BURNER_PROFILE_DRAW
  // Two micros() calls per run costs ~10% at 2,900 runs/frame. Only compile it
  // in when profiling: build with -D BURNER_PROFILE_DRAW.
  gifPushMicrosInProgress += micros() - pushStarted;
#endif
}

void pushGifRunOutsideHud(int x, int y, uint16_t* pixels, int width) {
  if (width < 1) return;
  const int right = x + width;
  if (y < kSummitCacheY
      || y >= kSummitCacheBottom
      || right <= kSummitCacheX
      || x >= kSummitCacheRight) {
    pushGifRunDirectOutsideHud(x, y, pixels, width);
    return;
  }

  const int overlapLeft = max(x, static_cast<int>(kSummitCacheX));
  const int overlapRight = min(right, static_cast<int>(kSummitCacheRight));
  if (x < overlapLeft) {
    pushGifRunDirectOutsideHud(x, y, pixels, overlapLeft - x);
  }

  const int sourceOffset = overlapLeft - x;
  const int cacheRow = (y - kSummitCacheY) * kSummitCacheWidth;
  const int cacheOffset = overlapLeft - kSummitCacheX;
  const int overlapWidth = overlapRight - overlapLeft;
  if (!summitCacheReady) {
    memcpy(
        summitCache + cacheRow + cacheOffset,
        pixels + sourceOffset,
        overlapWidth * sizeof(uint16_t));
    pushGifRunDirectOutsideHud(overlapLeft, y, pixels + sourceOffset, overlapWidth);
  } else {
    int offset = 0;
    while (offset < overlapWidth) {
      while (offset < overlapWidth
          && summitCache[cacheRow + cacheOffset + offset] == pixels[sourceOffset + offset]) {
        ++offset;
      }
      const int changedStart = offset;
      while (offset < overlapWidth
          && summitCache[cacheRow + cacheOffset + offset] != pixels[sourceOffset + offset]) {
        summitCache[cacheRow + cacheOffset + offset] = pixels[sourceOffset + offset];
        ++offset;
      }
      const int changedWidth = offset - changedStart;
      if (changedWidth > 0) {
        pushGifRunDirectOutsideHud(
            overlapLeft + changedStart,
            y,
            pixels + sourceOffset + changedStart,
            changedWidth);
      }
    }
  }

  if (overlapRight < right) {
    const int offset = overlapRight - x;
    pushGifRunDirectOutsideHud(overlapRight, y, pixels + offset, right - overlapRight);
  }
}

void drawGifLine(GIFDRAW* draw) {
  int width = draw->iWidth;
  if (draw->iX + width > kWidth) width = kWidth - draw->iX;
  const int y = draw->iY + draw->y;
  if (y < 0 || y >= kHeight || draw->iX < 0 || draw->iX >= kWidth || width < 1) return;

  uint8_t* source = draw->pPixels;
  uint16_t* palette = draw->pPalette;
  if (draw->ucDisposalMethod == 2) {
    for (int x = 0; x < width; ++x) {
      if (source[x] == draw->ucTransparent) source[x] = draw->ucBackground;
    }
    draw->ucHasTransparency = 0;
  }

  if (!draw->ucHasTransparency) {
    for (int x = 0; x < width; ++x) gifLineBuffer[x] = palette[source[x]];
    pushGifRunOutsideHud(draw->iX, y, gifLineBuffer, width);
    return;
  }

  // Conservative transparent-run drawing from the AnimatedGIF TFT_eSPI
  // reference path. Every scanline gets an explicit address window, avoiding
  // any dependence on a previous partial frame's write cursor.
  int x = 0;
  while (x < width) {
    while (x < width && source[x] == draw->ucTransparent) ++x;
    const int runStart = x;
    while (x < width && source[x] != draw->ucTransparent) {
      gifLineBuffer[x - runStart] = palette[source[x]];
      ++x;
    }
    const int runLength = x - runStart;
    if (runLength) {
      pushGifRunOutsideHud(draw->iX + runStart, y, gifLineBuffer, runLength);
    }
  }
}

void stopGifPlayback() {
  if (!gifPlaying) return;
  gifPlaying = false;
  gif.close();
}

bool startGifPlayback() {
  stopGifPlayback();
  if (!fileSystemReady || !LittleFS.exists(kActiveGifPath)) return false;
  gif.begin(GIF_PALETTE_RGB565_BE);
  if (!gif.open(kActiveGifPath, openGifFile, closeGifFile, readGifFile, seekGifFile, drawGifLine)) {
    if (gifReadFile) gifReadFile.close();
    return false;
  }
  if (gif.getCanvasWidth() != kWidth || gif.getCanvasHeight() != kHeight) {
    gif.close();
    return false;
  }
  gifPlaying = true;
  gifFramesPlayed = 0;
  gifLoopsCompleted = 0;
  lastGifRenderMicros = 0;
  summitCacheReady = false;
  fallbackVisible = false;
  waitingVisible = false;
  // Establish the protected layer before frame zero starts drawing around it.
  drawHud(currentLife, currentLevel);
  nextGifFrameAtMicros = micros();
  return true;
}

bool readGifMetadata(const char* path, uint32_t& bytes, uint32_t& checksum) {
  if (!fileSystemReady || !LittleFS.exists(path)) return false;
  File metadata = LittleFS.open(path, FILE_READ);
  uint8_t data[8];
  const bool valid = metadata && metadata.read(data, sizeof(data)) == sizeof(data);
  metadata.close();
  if (!valid) return false;
  bytes = readU32(data);
  checksum = readU32(data + 4);
  return true;
}

bool writeGifMetadata(const char* path, uint32_t bytes, uint32_t checksum) {
  File metadata = LittleFS.open(path, FILE_WRITE);
  if (!metadata) return false;
  uint8_t data[8];
  writeU32(data, bytes);
  writeU32(data + 4, checksum);
  const bool written = metadata.write(data, sizeof(data)) == sizeof(data);
  metadata.close();
  return written;
}

bool activeGifMatches(uint32_t bytes, uint32_t checksum) {
  if (!fileSystemReady || !LittleFS.exists(kActiveGifPath)) return false;
  uint32_t storedBytes = 0;
  uint32_t storedChecksum = 0;
  if (!readGifMetadata(kActiveGifMetadataPath, storedBytes, storedChecksum)) return false;
  File active = LittleFS.open(kActiveGifPath, FILE_READ);
  const bool metadataMatches = active
    && active.size() == bytes
    && storedBytes == bytes
    && storedChecksum == checksum;
  active.close();
  if (!metadataMatches) return false;
  uint32_t actualChecksum = 0;
  return computeFileCrc(kActiveGifPath, bytes, actualChecksum) && actualChecksum == checksum;
}

void cancelGifUpload(bool removePartial = true) {
  if (gifUploadFile) gifUploadFile.close();
  gifUploadInProgress = false;
  gifPromotionPending = false;
  gifUploadExpectedBytes = 0;
  gifUploadReceivedBytes = 0;
  gifUploadExpectedCrc = 0;
  gifUploadRunningCrc = 0xffffffff;
  if (removePartial && fileSystemReady) {
    LittleFS.remove(kIncomingGifPath);
    LittleFS.remove(kIncomingGifMetadataPath);
  }
}

bool computeFileCrc(const char* path, uint32_t expectedBytes, uint32_t& checksum) {
  File file = LittleFS.open(path, FILE_READ);
  if (!file || file.size() != expectedBytes) {
    file.close();
    return false;
  }
  uint8_t buffer[1024];
  uint32_t crc = 0xffffffff;
  uint32_t bytesRead = 0;
  while (bytesRead < expectedBytes) {
    const size_t wanted = min<size_t>(sizeof(buffer), expectedBytes - bytesRead);
    const size_t read = file.read(buffer, wanted);
    if (read != wanted) {
      file.close();
      return false;
    }
    crc = updateCrc32(crc, buffer, read);
    bytesRead += read;
    delay(0);
  }
  file.close();
  checksum = crc ^ 0xffffffff;
  return true;
}

bool validateGifWithDecoder(const char* path) {
  File staged = LittleFS.open(path, FILE_READ);
  if (!staged || staged.size() < 6 || staged.size() > kMaximumGifBytes) {
    staged.close();
    return false;
  }
  staged.close();

  gifValidator.begin(GIF_PALETTE_RGB565_BE);
  if (!gifValidator.open(
        path,
        openGifValidationFile,
        closeGifFile,
        readGifFile,
        seekGifFile,
        discardGifLine)) {
    if (gifValidationFile) gifValidationFile.close();
    return false;
  }
  if (gifValidator.getCanvasWidth() != kWidth || gifValidator.getCanvasHeight() != kHeight) {
    gifValidator.close();
    return false;
  }

  uint16_t decodedFrames = 0;
  bool valid = true;
  while (true) {
    gifValidationCheckingFirstFrame = decodedFrames == 0;
    if (gifValidationCheckingFirstFrame) {
      gifValidationFirstFrameOkay = true;
      gifValidationNextRow = 0;
    }
    int frameDelayMs = 0;
    const int result = gifValidator.playFrame(false, &frameDelayMs);
    const int error = gifValidator.getLastError();
    if (result < 0 || (error != GIF_SUCCESS && error != GIF_EMPTY_FRAME)) {
      valid = false;
      break;
    }
    if (gifValidationCheckingFirstFrame
        && (!gifValidationFirstFrameOkay || gifValidationNextRow != kHeight)) {
      valid = false;
      break;
    }
    if (error == GIF_SUCCESS) ++decodedFrames;
    if (result == 0) break;
    if (decodedFrames >= kMaximumValidationFrames) {
      valid = false;
      break;
    }
    delay(0);
  }
  gifValidationCheckingFirstFrame = false;
  gifValidator.close();
  return valid && decodedFrames > 0;
}

void recoverInterruptedGifPromotion() {
  if (!fileSystemReady) return;

  // A rollback file exists only between moving the old active GIF aside and
  // successfully opening the replacement. On boot, prefer the known-good old
  // file; a later GifBegin can safely retry the staged candidate.
  if (LittleFS.exists(kRollbackGifPath)) {
    LittleFS.remove(kActiveGifPath);
    LittleFS.remove(kActiveGifMetadataPath);
    LittleFS.rename(kRollbackGifPath, kActiveGifPath);
    if (LittleFS.exists(kRollbackGifMetadataPath)) {
      LittleFS.rename(kRollbackGifMetadataPath, kActiveGifMetadataPath);
    }
  } else {
    LittleFS.remove(kRollbackGifMetadataPath);
  }
  LittleFS.remove(kIncomingGifPath);
  LittleFS.remove(kIncomingGifMetadataPath);
}

bool promoteStagedGif() {
  if (!gifPromotionPending || gifUploadInProgress) return false;

  uint32_t stagedBytes = 0;
  uint32_t stagedChecksum = 0;
  if (!LittleFS.exists(kIncomingGifPath)
      || !readGifMetadata(kIncomingGifMetadataPath, stagedBytes, stagedChecksum)
      || stagedBytes != gifUploadExpectedBytes
      || stagedChecksum != gifUploadExpectedCrc) {
    cancelGifUpload();
    if (gifPlaying) gif.reset();
    return false;
  }

  const bool hadActiveGif = LittleFS.exists(kActiveGifPath);
  const bool hadActiveMetadata = LittleFS.exists(kActiveGifMetadataPath);
  stopGifPlayback();
  LittleFS.remove(kRollbackGifPath);
  LittleFS.remove(kRollbackGifMetadataPath);

  if (hadActiveGif && !LittleFS.rename(kActiveGifPath, kRollbackGifPath)) {
    cancelGifUpload();
    startGifPlayback();
    return false;
  }
  if (hadActiveMetadata && !LittleFS.rename(kActiveGifMetadataPath, kRollbackGifMetadataPath)) {
    if (hadActiveGif) LittleFS.rename(kRollbackGifPath, kActiveGifPath);
    cancelGifUpload();
    startGifPlayback();
    return false;
  }
  if (!LittleFS.rename(kIncomingGifPath, kActiveGifPath)) {
    if (hadActiveGif) LittleFS.rename(kRollbackGifPath, kActiveGifPath);
    if (hadActiveMetadata) LittleFS.rename(kRollbackGifMetadataPath, kActiveGifMetadataPath);
    cancelGifUpload();
    startGifPlayback();
    return false;
  }
  if (!LittleFS.rename(kIncomingGifMetadataPath, kActiveGifMetadataPath)) {
    LittleFS.remove(kActiveGifPath);
    if (hadActiveGif) LittleFS.rename(kRollbackGifPath, kActiveGifPath);
    if (hadActiveMetadata) LittleFS.rename(kRollbackGifMetadataPath, kActiveGifMetadataPath);
    cancelGifUpload();
    startGifPlayback();
    return false;
  }

  gifPromotionPending = false;
  bool replacementStarted = startGifPlayback();
  if (replacementStarted) {
    // Render frame zero while the rollback file still exists. The validated
    // production GIFs use a full-canvas first frame, whose scanlines are pushed
    // in top-to-bottom callback order by AnimatedGIF.
    playGifFrameIfDue();
    replacementStarted = gifPlaying && gifFramesPlayed > 0;
  }
  if (!replacementStarted) {
    LittleFS.remove(kActiveGifPath);
    LittleFS.remove(kActiveGifMetadataPath);
    if (hadActiveGif) LittleFS.rename(kRollbackGifPath, kActiveGifPath);
    if (hadActiveMetadata) LittleFS.rename(kRollbackGifMetadataPath, kActiveGifMetadataPath);
    if (startGifPlayback()) playGifFrameIfDue();
    cancelGifUpload(false);
    return false;
  }

  if (LittleFS.exists(kRollbackGifPath) && !LittleFS.remove(kRollbackGifPath)) {
    // A surviving rollback marker would make boot recovery undo an ACKed
    // promotion. Treat cleanup failure as promotion failure and restore now.
    stopGifPlayback();
    LittleFS.remove(kActiveGifPath);
    LittleFS.remove(kActiveGifMetadataPath);
    LittleFS.rename(kRollbackGifPath, kActiveGifPath);
    if (LittleFS.exists(kRollbackGifMetadataPath)) {
      LittleFS.rename(kRollbackGifMetadataPath, kActiveGifMetadataPath);
    }
    if (startGifPlayback()) playGifFrameIfDue();
    cancelGifUpload(false);
    return false;
  }
  LittleFS.remove(kRollbackGifMetadataPath);
  gifUploadExpectedBytes = 0;
  gifUploadReceivedBytes = 0;
  gifUploadExpectedCrc = 0;
  gifUploadRunningCrc = 0xffffffff;
  haveKeyframe = false;
  keyframeInProgress = false;
  return true;
}

void completePendingGifPromotion() {
  if (!gifPromotionPending || !deferredGifCommit.pending()) return;
  const bool promoted = promoteStagedGif();
  const uint32_t commitSequence = deferredGifCommit.resolve();
  const uint8_t acknowledgementType = promoted ? Ack : Nack;
  const uint8_t acknowledgementCode = promoted ? Okay : BadPayload;

  // Cache both success and failure so a delayed duplicate COMMIT receives the
  // exact same terminal response without re-running validation or promotion.
  lastPacketAt = millis();
  lastSequence = commitSequence;
  lastAcknowledgementType = acknowledgementType;
  lastAcknowledgementCode = acknowledgementCode;
  sequenceStarted = true;
  sendAcknowledgement(acknowledgementType, commitSequence, acknowledgementCode);
}

uint16_t lifeColor(uint8_t life) {
  uint8_t red;
  uint8_t green;
  uint8_t blue;
  if (life <= 25) {
    const float t = life / 25.0f;
    red = 112 + (200 - 112) * t;
    green = 58 + (55 - 58) * t;
    blue = 61 + (38 - 61) * t;
  } else if (life <= 70) {
    const float t = (life - 25) / 45.0f;
    red = 200 + (244 - 200) * t;
    green = 55 + (122 - 55) * t;
    blue = 38 + (24 - 38) * t;
  } else {
    const float t = (life - 70) / 30.0f;
    red = 244 + (255 - 244) * t;
    green = 122 + (205 - 122) * t;
    blue = 24 + (58 - 24) * t;
  }
  return display.color565(red, green, blue);
}

void drawHud(uint8_t life, uint8_t level) {
  life = min<uint8_t>(100, life);
  level = constrain(level, 1, 3);
  currentLife = life;
  currentLevel = level;
  display.fillRect(kHudX, kHudY, kHudWidth, kHudHeight, display.color565(5, 10, 18));
  display.drawRect(kHudX, kHudY, kHudWidth, kHudHeight, display.color565(79, 91, 108));
  display.drawFastHLine(9, 9, 118, display.color565(151, 84, 37));
  display.setTextFont(1);
  display.setTextSize(1);
  display.setTextDatum(TL_DATUM);
  display.setTextColor(display.color565(255, 239, 193), display.color565(5, 10, 18));
  display.drawString("LIFE", 11, 11);
  display.drawString(String(life) + "%", 44, 11);
  display.setTextColor(display.color565(255, 181, 52), display.color565(5, 10, 18));
  display.drawString("LV." + String(level), 96, 11);
  display.fillRect(11, 23, 114, 9, display.color565(15, 18, 24));
  display.drawRect(11, 23, 114, 9, display.color565(167, 164, 151));
  display.fillRect(13, 25, 110, 5, display.color565(42, 43, 48));
  const uint16_t fillWidth = static_cast<uint16_t>(110 * life / 100);
  if (fillWidth) display.fillRect(13, 25, fillWidth, 5, lifeColor(life));
  lastHudLife = life;
  lastHudLevel = level;
}

void playGifFrameIfDue() {
  if (!gifPlaying) return;
  const uint32_t now = micros();
  if (static_cast<int32_t>(now - nextGifFrameAtMicros) < 0) return;

  int frameDelayMs = 0;
  const uint32_t renderStarted = micros();
  const bool establishingSummitCache = !summitCacheReady;
  gifRunsInProgress = 0;
  gifPushMicrosInProgress = 0;
  display.setSwapBytes(false);
  display.startWrite();
  const int result = gif.playFrame(false, &frameDelayMs);
  display.endWrite();
  gifRunsLastFrame = gifRunsInProgress;
  gifPushMicrosLastFrame = gifPushMicrosInProgress;
  if (result < 0) {
    stopGifPlayback();
    return;
  }
  if (establishingSummitCache) summitCacheReady = true;
  lastGifRenderMicros = micros() - renderStarted;
  gifFramesPlayed += 1;
  if (currentLife != lastHudLife || currentLevel != lastHudLevel) {
    drawHud(currentLife, currentLevel);
  }
  if (result == 0) {
    gifLoopsCompleted += 1;
    if (gifPromotionPending) {
      // The final frame of the old loop remains on-screen while the filesystem
      // names are swapped. The replacement starts from frame zero, so there is
      // no mid-frame tear or partially decoded image.
      completePendingGifPromotion();
      return;
    }
    gif.reset();
  }

  // Device GIFs carry their own cadence. The approved full-scene library uses
  // 40/40/40/40/40/50 ms for exact 24 FPS. Frame zero is still decoded on
  // every loop, but the summit cache suppresses identical high-contrast pixels.
  const uint32_t duration = static_cast<uint32_t>(max(10, frameDelayMs)) * 1000UL;
  nextGifFrameAtMicros += duration;
  if (static_cast<int32_t>(now - nextGifFrameAtMicros) > static_cast<int32_t>(duration)) {
    nextGifFrameAtMicros = now + duration;
  }
}

void drawNoConnectionLabel() {
  // The fallback artwork already contains a purpose-built empty banner at
  // x=66..254, y=45..68. Draw only the glyphs into that banner; adding a new
  // box near the ground line would cover dormant Ember's face.
  display.setTextDatum(MC_DATUM);
  display.setTextFont(1);
  display.setTextSize(2);
  display.setTextColor(display.color565(255, 224, 167));
  display.drawString("NO CONNECTION", kOfflineLabelCenterX, kOfflineLabelCenterY);
  display.setTextSize(1);
  display.setTextDatum(TL_DATUM);
}

void drawNoConnection() {
  stopGifPlayback();
  const bool hadDeferredCommit = deferredGifCommit.pending();
  const uint32_t deferredSequence = hadDeferredCommit ? deferredGifCommit.resolve() : 0;
  if (gifUploadInProgress || gifPromotionPending) cancelGifUpload();
  if (hadDeferredCommit) {
    // A true 1.5-second link loss wins over an in-flight loop-boundary swap.
    // The known-good active GIF remains stored; cache the terminal NACK so a
    // delayed duplicate COMMIT cannot be mistaken for a successful promotion.
    lastSequence = deferredSequence;
    lastAcknowledgementType = Nack;
    lastAcknowledgementCode = BadPayload;
    sequenceStarted = true;
    sendAcknowledgement(Nack, deferredSequence, BadPayload);
  }
  uint16_t row[kWidth];
  uint32_t pixel = 0;
  size_t cursor = 0;
  display.setSwapBytes(true);
  display.startWrite();
  while (cursor + 1 < kNoConnectionRleSize && pixel < kPixelCount) {
    const uint8_t count = pgm_read_byte(kNoConnectionRle + cursor++);
    const uint8_t paletteIndex = pgm_read_byte(kNoConnectionRle + cursor++);
    const uint16_t color = pgm_read_word(kNoConnectionPalette + paletteIndex);
    for (uint8_t inner = 0; inner < count && pixel < kPixelCount; ++inner, ++pixel) {
      row[pixel % kWidth] = color;
      if (pixel % kWidth == kWidth - 1) {
        display.setAddrWindow(0, pixel / kWidth, kWidth, 1);
        display.pushPixels(row, kWidth);
      }
    }
  }
  display.endWrite();
  display.setSwapBytes(false);
  drawNoConnectionLabel();
  fallbackVisible = true;
  waitingVisible = false;
  haveKeyframe = false;
  lastHudLife = 255;
  lastHudLevel = 0;
}

void drawWaiting() {
  stopGifPlayback();
  if (gifUploadInProgress || gifPromotionPending) cancelGifUpload();
  display.fillScreen(display.color565(7, 11, 18));
  display.setTextDatum(MC_DATUM);
  display.setTextColor(display.color565(255, 123, 31), display.color565(7, 11, 18));
  display.setTextSize(2);
  display.drawString("CLAUDE BURNER", 160, 94);
  display.setTextColor(display.color565(255, 230, 180), display.color565(7, 11, 18));
  display.setTextSize(1);
  display.drawString("WAITING FOR CLAUDE", 160, 126);
  display.drawString("Run Claude Code on your Mac", 160, 146);
  display.setTextDatum(TL_DATUM);
  waitingVisible = true;
  fallbackVisible = false;
  haveKeyframe = false;
  lastHudLife = 255;
  lastHudLevel = 0;
}

void sendAcknowledgement(uint8_t type, uint32_t acknowledgedSequence, uint8_t code) {
  constexpr uint32_t acknowledgementBytes = 25;   // 17 + runs + pushMicros
  uint8_t body[kHeaderBytes + acknowledgementBytes + kCrcBytes];
  body[0] = kVersion;
  body[1] = type;
  body[2] = 0;
  body[3] = 0;
  static uint32_t outgoingSequence = 1;
  writeU32(body + 4, outgoingSequence++);
  writeU32(body + 8, acknowledgementBytes);
  writeU32(body + 12, acknowledgedSequence);
  body[16] = code;
  writeU32(body + 17, gifFramesPlayed);
  writeU32(body + 21, gifLoopsCompleted);
  writeU32(body + 25, lastGifRenderMicros);
  writeU32(body + 29, gifRunsLastFrame);
  writeU32(body + 33, gifPushMicrosLastFrame);
  writeU32(body + 37, crc32(body, 37));
  uint8_t encoded[64];
  const size_t encodedLength = cobsEncode(body, sizeof(body), encoded, sizeof(encoded) - 1);
  if (encodedLength) {
    encoded[encodedLength] = 0;
    Serial.write(encoded, encodedLength + 1);
  }
}

bool validSequence(uint32_t sequence, uint8_t type) {
  if (type == Hello || !sequenceStarted) return true;
  if (sequence == lastSequence) return true;
  return sequence == lastSequence + 1 || (lastSequence == UINT32_MAX && sequence == 1);
}

bool drawKeyframe(const uint8_t* payload, uint32_t length) {
  if (length < 14 || readU16(payload) != kWidth || readU16(payload + 2) != kHeight) return false;
  const uint8_t life = payload[4];
  const uint8_t level = payload[5];
  const uint8_t flags = payload[6];
  const uint32_t startPixel = readU32(payload + 8);
  const uint16_t pixelCount = readU16(payload + 12);
  if (length != 14 + pixelCount * 2 || !pixelCount || startPixel + pixelCount > kPixelCount) return false;
  if (startPixel % kWidth != 0 || pixelCount % kWidth != 0) return false;
  if (flags & 1) {
    stopGifPlayback();
    keyframeInProgress = true;
    haveKeyframe = false;
    nextKeyframePixel = 0;
  }
  if (!keyframeInProgress || startPixel != nextKeyframePixel) return false;
  const uint16_t startRow = startPixel / kWidth;
  const uint16_t rowCount = pixelCount / kWidth;
  display.setSwapBytes(true);
  display.startWrite();
  display.setAddrWindow(0, startRow, kWidth, rowCount);
  display.pushPixels(reinterpret_cast<const uint16_t*>(payload + 14), pixelCount);
  display.endWrite();
  display.setSwapBytes(false);
  nextKeyframePixel += pixelCount;
  if (flags & 2) {
    if (nextKeyframePixel != kPixelCount) return false;
    keyframeInProgress = false;
    haveKeyframe = true;
    drawHud(life, level);
  }
  fallbackVisible = false;
  waitingVisible = false;
  return true;
}

bool drawDelta(const uint8_t* payload, uint32_t length) {
  if (!haveKeyframe || length < 4) return false;
  const uint8_t life = payload[0];
  const uint8_t level = payload[1];
  const uint16_t spanCount = readU16(payload + 2);
  uint32_t offset = 4;
  bool redrawHud = life != lastHudLife || level != lastHudLevel;
  display.setSwapBytes(true);
  display.startWrite();
  for (uint16_t index = 0; index < spanCount; ++index) {
    if (offset + 6 > length) { display.endWrite(); display.setSwapBytes(false); return false; }
    const uint32_t startPixel = readU32(payload + offset);
    const uint16_t count = readU16(payload + offset + 4);
    offset += 6;
    if (!count || startPixel >= kPixelCount || startPixel + count > kPixelCount || offset + count * 2 > length) {
      display.endWrite(); display.setSwapBytes(false); return false;
    }
    const uint16_t x = startPixel % kWidth;
    const uint16_t y = startPixel / kWidth;
    if (x + count > kWidth) { display.endWrite(); display.setSwapBytes(false); return false; }
    if (y >= 8 && y < 35 && x < 128 && x + count > 8) redrawHud = true;
    display.setAddrWindow(x, y, count, 1);
    display.pushPixels(reinterpret_cast<const uint16_t*>(payload + offset), count);
    offset += count * 2;
  }
  display.endWrite();
  display.setSwapBytes(false);
  if (offset != length) return false;
  if (redrawHud) drawHud(life, level);
  return true;
}

uint8_t beginGifUpload(const uint8_t* payload, uint32_t length) {
  if (length != 14 || !fileSystemReady) return BadPayload;
  const uint32_t bytes = readU32(payload);
  const uint32_t checksum = readU32(payload + 4);
  if (readU16(payload + 8) != kWidth
      || readU16(payload + 10) != kHeight
      || bytes < 6
      || bytes > kMaximumGifBytes) {
    return BadPayload;
  }
  currentLife = min<uint8_t>(100, payload[12]);
  currentLevel = constrain(payload[13], 1, 3);

  if (activeGifMatches(bytes, checksum)) {
    cancelGifUpload();
    if (!gifPlaying && !startGifPlayback()) return BadPayload;
    return GifAlreadyLoaded;
  }

  cancelGifUpload();
  const size_t freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
  if (freeBytes < bytes + 16U) return BadPayload;

  gifUploadFile = LittleFS.open(kIncomingGifPath, FILE_WRITE);
  if (!gifUploadFile) return BadPayload;
  gifUploadInProgress = true;
  gifUploadExpectedBytes = bytes;
  gifUploadExpectedCrc = checksum;
  gifUploadReceivedBytes = 0;
  gifUploadRunningCrc = 0xffffffff;
  fallbackVisible = false;
  waitingVisible = false;
  return Okay;
}

uint8_t appendGifChunk(const uint8_t* payload, uint32_t length) {
  if (!gifUploadInProgress || !gifUploadFile || length <= 4) return BadPayload;
  const uint32_t offset = readU32(payload);
  const size_t chunkBytes = length - 4;
  if (offset != gifUploadReceivedBytes || gifUploadReceivedBytes + chunkBytes > gifUploadExpectedBytes) return BadPayload;
  if (gifUploadFile.write(payload + 4, chunkBytes) != chunkBytes) {
    cancelGifUpload();
    return BadPayload;
  }
  gifUploadRunningCrc = updateCrc32(gifUploadRunningCrc, payload + 4, chunkBytes);
  gifUploadReceivedBytes += chunkBytes;
  return Okay;
}

uint8_t commitGifUpload(const uint8_t* payload, uint32_t length) {
  if (!gifUploadInProgress || length != 8) return BadPayload;
  const uint32_t bytes = readU32(payload);
  const uint32_t checksum = readU32(payload + 4);
  gifUploadFile.flush();
  gifUploadFile.close();
  const uint32_t actualChecksum = gifUploadRunningCrc ^ 0xffffffff;
  bool valid = bytes == gifUploadExpectedBytes
    && checksum == gifUploadExpectedCrc
    && gifUploadReceivedBytes == gifUploadExpectedBytes
    && actualChecksum == gifUploadExpectedCrc;
  gifUploadInProgress = false;

  uint32_t storedChecksum = 0;
  valid = valid
    && computeFileCrc(kIncomingGifPath, bytes, storedChecksum)
    && storedChecksum == checksum
    && validateGifWithDecoder(kIncomingGifPath)
    && writeGifMetadata(kIncomingGifMetadataPath, bytes, checksum);
  if (!valid) {
    cancelGifUpload();
    return BadPayload;
  }

  gifPromotionPending = true;
  return Okay;
}

void handlePacket(uint8_t* body, size_t length) {
  if (length < kHeaderBytes + kCrcBytes) return;
  const uint8_t version = body[0];
  const uint8_t type = body[1];
  const uint32_t sequence = readU32(body + 4);
  const uint32_t payloadLength = readU32(body + 8);
  if (payloadLength != length - kHeaderBytes - kCrcBytes) {
    sendAcknowledgement(Nack, sequence, BadLength);
    return;
  }
  if (version != kVersion) {
    sendAcknowledgement(Nack, sequence, BadVersion);
    return;
  }
  if (readU32(body + length - kCrcBytes) != crc32(body, length - kCrcBytes)) {
    sendAcknowledgement(Nack, sequence, BadCrc);
    return;
  }

  const DeferredPacketAction deferredAction = deferredGifCommit.actionFor(
    sequence,
    type == Hello,
    type == GifCommit);
  if (deferredAction == DeferredPacketAction::SuppressDuplicateCommit) {
    // The original COMMIT has not reached its loop-boundary terminal state.
    // Suppress retries rather than ACKing early or executing it twice.
    lastPacketAt = millis();
    return;
  }
  if (deferredAction == DeferredPacketAction::RejectUntilResolved) {
    sendAcknowledgement(Nack, sequence, BadSequence);
    return;
  }
  if (deferredAction == DeferredPacketAction::AbandonForHello) {
    cancelGifUpload();
    deferredGifCommit.abandon();
  }
  if (!validSequence(sequence, type)) {
    sendAcknowledgement(Nack, sequence, BadSequence);
    return;
  }
  if (sequenceStarted && sequence == lastSequence) {
    lastPacketAt = millis();
    sendAcknowledgement(lastAcknowledgementType, sequence, lastAcknowledgementCode);
    return;
  }

  const uint8_t* payload = body + kHeaderBytes;
  uint8_t result = Okay;
  switch (type) {
    case Hello:
      if (payloadLength != 12 || readU16(payload) != kWidth || readU16(payload + 2) != kHeight) result = BadPayload;
      else { haveKeyframe = false; keyframeInProgress = false; sequenceStarted = false; }
      break;
    case Keyframe:
      if (!drawKeyframe(payload, payloadLength)) result = BadPayload;
      else linkRecoveryState.markStreaming();
      break;
    case Delta:
      if (!haveKeyframe) result = NeedKeyframe;
      else if (!drawDelta(payload, payloadLength)) result = BadPayload;
      else linkRecoveryState.markStreaming();
      break;
    case Heartbeat:
      if (payloadLength != 0) result = BadPayload;
      else {
        const HeartbeatRecoveryAction recoveryAction = linkRecoveryState.actionForHeartbeat(
          fallbackVisible,
          LittleFS.exists(kActiveGifPath));
        if (recoveryAction == HeartbeatRecoveryAction::ShowWaitingForClaude) {
          drawWaiting();
        } else if (recoveryAction == HeartbeatRecoveryAction::ResumeStreaming) {
          if (!startGifPlayback()) result = BadPayload;
          else {
            playGifFrameIfDue();
            if (!gifPlaying || gifFramesPlayed == 0) result = BadPayload;
          }
        }
      }
      break;
    case Status:
      if (payloadLength != 4) result = BadPayload;
      else if (payload[0] == WaitingForClaude) {
        linkRecoveryState.markWaitingForClaude();
        drawWaiting();
      }
      else if (payload[0] == NoConnection) {
        linkRecoveryState.markNoConnection();
        drawNoConnection();
      }
      else if (payload[0] == Streaming) {
        linkRecoveryState.markStreaming();
        currentLife = min<uint8_t>(100, payload[1]);
        currentLevel = constrain(payload[2], 1, 3);
        if (fallbackVisible && LittleFS.exists(kActiveGifPath)) {
          if (!startGifPlayback()) result = BadPayload;
          else {
            playGifFrameIfDue();
            if (!gifPlaying || gifFramesPlayed == 0) result = BadPayload;
          }
        }
      }
      break;
    case GifBegin:
      result = beginGifUpload(payload, payloadLength);
      if (result == Okay || result == GifAlreadyLoaded) linkRecoveryState.markStreaming();
      break;
    case GifChunk:
      result = appendGifChunk(payload, payloadLength);
      break;
    case GifCommit:
      result = commitGifUpload(payload, payloadLength);
      if (result == Okay) {
        if (!deferredGifCommit.begin(sequence)) {
          cancelGifUpload();
          result = BadSequence;
        } else {
          // Do not resolve this packet until promotion reaches a loop boundary
          // and frame zero of the replacement has completely decoded/drawn.
          lastPacketAt = millis();
          return;
        }
      }
      break;
    case HudUpdate:
      if (payloadLength != 2) result = BadPayload;
      else {
        currentLife = min<uint8_t>(100, payload[0]);
        currentLevel = constrain(payload[1], 1, 3);
        if (gifPlaying && (currentLife != lastHudLife || currentLevel != lastHudLevel)) {
          drawHud(currentLife, currentLevel);
        }
      }
      break;
    default:
      result = BadPayload;
      break;
  }
  if (result == Okay || result == GifAlreadyLoaded) {
    lastPacketAt = millis();
    lastSequence = sequence;
    lastAcknowledgementType = Ack;
    lastAcknowledgementCode = result;
    sequenceStarted = true;
    sendAcknowledgement(Ack, sequence, result);
  } else {
    sendAcknowledgement(Nack, sequence, result);
  }
}

void receiveSerial() {
  while (Serial.available()) {
    const uint8_t byte = Serial.read();
    if (byte == 0) {
      if (packetLength) {
        const size_t decodedLength = cobsDecodeInPlace(packetBuffer, packetLength);
        if (decodedLength) handlePacket(packetBuffer, decodedLength);
      }
      packetLength = 0;
    } else if (packetLength < kMaximumPacketBytes) {
      packetBuffer[packetLength++] = byte;
    } else {
      packetLength = 0;
    }
  }
}

}  // namespace

void setup() {
  pinMode(kBacklightPin, OUTPUT);
  digitalWrite(kBacklightPin, HIGH);
  Serial.setRxBufferSize(32768);
  Serial.begin(kSerialBaud);
  packetBuffer = static_cast<uint8_t*>(malloc(kMaximumPacketBytes));
  display.init();
  display.setRotation(1);
  display.setSwapBytes(false);
  display.fillScreen(TFT_BLACK);
  fileSystemReady = LittleFS.begin(true);
  if (!packetBuffer || !fileSystemReady) {
    display.setTextColor(TFT_RED, TFT_BLACK);
    display.drawString("MEMORY / FLASH ERROR", 82, 116, 2);
    while (true) delay(1000);
  }
  recoverInterruptedGifPromotion();
  drawNoConnection();
  lastPacketAt = millis();
}

void loop() {
  receiveSerial();
  playGifFrameIfDue();
  if (gifPromotionPending && !gifPlaying) completePendingGifPromotion();
  const uint32_t linkIdleMs = millis() - lastPacketAt;
  if (!fallbackVisible
      && linkIdleMs > kConnectionTimeoutMs) {
    drawNoConnection();
  }
  delay(0);
}
