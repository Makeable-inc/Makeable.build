#pragma once

#include <cstdint>

namespace BurnerProtocol {

enum class DesiredLinkPresentation : uint8_t {
  NoConnection,
  WaitingForClaude,
  Streaming,
};

enum class HeartbeatRecoveryAction : uint8_t {
  None,
  ShowWaitingForClaude,
  ResumeStreaming,
};

class LinkRecoveryState {
 public:
  void markNoConnection() { desired_ = DesiredLinkPresentation::NoConnection; }
  void markWaitingForClaude() { desired_ = DesiredLinkPresentation::WaitingForClaude; }
  void markStreaming() { desired_ = DesiredLinkPresentation::Streaming; }
  DesiredLinkPresentation desired() const { return desired_; }

  HeartbeatRecoveryAction actionForHeartbeat(bool fallbackVisible, bool activeGifAvailable) const {
    if (!fallbackVisible) return HeartbeatRecoveryAction::None;
    if (desired_ == DesiredLinkPresentation::WaitingForClaude) {
      return HeartbeatRecoveryAction::ShowWaitingForClaude;
    }
    if (desired_ == DesiredLinkPresentation::Streaming && activeGifAvailable) {
      return HeartbeatRecoveryAction::ResumeStreaming;
    }
    return HeartbeatRecoveryAction::None;
  }

 private:
  DesiredLinkPresentation desired_ = DesiredLinkPresentation::NoConnection;
};

}  // namespace BurnerProtocol
