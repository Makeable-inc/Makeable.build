#pragma once

#include <cstdint>

namespace BurnerProtocol {

enum class DeferredPacketAction : uint8_t {
  ProcessNormally,
  SuppressDuplicateCommit,
  RejectUntilResolved,
  AbandonForHello,
};

class DeferredCommitAcknowledgement {
 public:
  bool begin(uint32_t sequence) {
    if (pending_) return false;
    pending_ = true;
    sequence_ = sequence;
    return true;
  }

  bool pending() const { return pending_; }
  uint32_t sequence() const { return sequence_; }

  DeferredPacketAction actionFor(uint32_t sequence, bool isHello, bool isGifCommit) const {
    if (!pending_) return DeferredPacketAction::ProcessNormally;
    if (isHello) return DeferredPacketAction::AbandonForHello;
    if (isGifCommit && sequence == sequence_) {
      return DeferredPacketAction::SuppressDuplicateCommit;
    }
    return DeferredPacketAction::RejectUntilResolved;
  }

  uint32_t resolve() {
    const uint32_t sequence = sequence_;
    pending_ = false;
    sequence_ = 0;
    return sequence;
  }

  void abandon() {
    pending_ = false;
    sequence_ = 0;
  }

 private:
  bool pending_ = false;
  uint32_t sequence_ = 0;
};

}  // namespace BurnerProtocol
