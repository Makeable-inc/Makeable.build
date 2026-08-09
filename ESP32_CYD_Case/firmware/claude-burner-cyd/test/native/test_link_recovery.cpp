#include <cassert>
#include <cstdio>

#include "link_recovery.h"

using BurnerProtocol::DesiredLinkPresentation;
using BurnerProtocol::HeartbeatRecoveryAction;
using BurnerProtocol::LinkRecoveryState;

int main() {
  LinkRecoveryState state;
  assert(state.desired() == DesiredLinkPresentation::NoConnection);
  assert(state.actionForHeartbeat(true, true) == HeartbeatRecoveryAction::None);

  state.markStreaming();
  assert(state.actionForHeartbeat(false, true) == HeartbeatRecoveryAction::None);
  assert(state.actionForHeartbeat(true, false) == HeartbeatRecoveryAction::None);
  assert(state.actionForHeartbeat(true, true) == HeartbeatRecoveryAction::ResumeStreaming);

  state.markWaitingForClaude();
  assert(state.actionForHeartbeat(true, true) == HeartbeatRecoveryAction::ShowWaitingForClaude);
  assert(state.actionForHeartbeat(true, false) == HeartbeatRecoveryAction::ShowWaitingForClaude);

  state.markNoConnection();
  assert(state.actionForHeartbeat(true, true) == HeartbeatRecoveryAction::None);

  std::puts("PASS heartbeat display recovery state");
  return 0;
}
