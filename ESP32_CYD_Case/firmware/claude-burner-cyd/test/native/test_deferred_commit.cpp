#include <cassert>
#include <cstdint>
#include <cstdio>

#include "deferred_commit.h"

using BurnerProtocol::DeferredCommitAcknowledgement;
using BurnerProtocol::DeferredPacketAction;

int main() {
  DeferredCommitAcknowledgement deferred;
  assert(!deferred.pending());
  assert(deferred.actionFor(10, false, true) == DeferredPacketAction::ProcessNormally);

  assert(deferred.begin(41));
  assert(!deferred.begin(42));
  assert(deferred.pending());
  assert(deferred.sequence() == 41);
  assert(deferred.actionFor(41, false, true) == DeferredPacketAction::SuppressDuplicateCommit);
  assert(deferred.actionFor(42, false, true) == DeferredPacketAction::RejectUntilResolved);
  assert(deferred.actionFor(42, false, false) == DeferredPacketAction::RejectUntilResolved);
  assert(deferred.actionFor(1, true, false) == DeferredPacketAction::AbandonForHello);

  assert(deferred.resolve() == 41);
  assert(!deferred.pending());
  assert(deferred.actionFor(41, false, true) == DeferredPacketAction::ProcessNormally);

  assert(deferred.begin(UINT32_MAX));
  deferred.abandon();
  assert(!deferred.pending());
  assert(deferred.sequence() == 0);

  std::puts("PASS deferred GIF_COMMIT acknowledgement state");
  return 0;
}
