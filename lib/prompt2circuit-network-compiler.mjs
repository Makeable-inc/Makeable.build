import { createHash } from "node:crypto";

// ESP-NOW supports more peers in some ESP-IDF configurations, but Makeable's
// production contract deliberately stays inside the default encrypted-peer
// envelope: one coordinator plus at most seven encrypted peers. A larger
// topology must be an explicit deployment decision, never an accidental
// consequence of a very large BOM.
export const ESP_NOW_DEFAULT_MAX_NODES = 8;
export const ESP_NOW_COMPATIBILITY_PAYLOAD_BYTES = 250;

export function mergePrompt2CircuitNodes(nodes = []) {
  if (!Array.isArray(nodes) || !nodes.length) throw new Error("prompt2circuit_network_nodes_missing");
  if (nodes.some((node) => !node?.graph || !node?.placement)) {
    throw new Error("prompt2circuit_network_node_contract_incomplete");
  }
  if (nodes.length === 1) {
    return {
      graph: nodes[0].graph,
      placement: nodes[0].placement,
      networkNodes: [networkNodeRecord(nodes[0], "coordinator", [0, 0, 0])],
      wirelessLinks: [],
      firmware: {
        source: "",
        state: "not-generated-by-circuit-compiler",
        transportContract: null,
      },
    };
  }
  if (nodes.length > ESP_NOW_DEFAULT_MAX_NODES) {
    throw new Error(`espnow_default_encrypted_node_limit_exceeded:${nodes.length}/${ESP_NOW_DEFAULT_MAX_NODES}`);
  }

  const arranged = arrangeNodes(nodes);
  const networkNodes = arranged.map((entry, index) => networkNodeRecord(
    entry.node,
    index === 0 ? "coordinator" : "sensor_node",
    entry.offset,
  ));
  const wirelessLinks = networkNodes.slice(1).map((node, index) => wirelessLink(
    networkNodes[0],
    node,
    arranged[0].placement,
    arranged[index + 1].placement,
  ));
  const graph = mergeGraphs(arranged, networkNodes, wirelessLinks);
  const placement = mergePlacements(arranged, graph, networkNodes, wirelessLinks);
  const transportContract = createEspNowFirmwareContract(networkNodes, wirelessLinks);
  assertEspNowFirmwareContract(transportContract);

  return {
    graph,
    placement,
    networkNodes,
    wirelessLinks,
    firmware: {
      source: "",
      state: "transport-contract-ready-source-generation-disabled",
      transportContract,
    },
  };
}

export function createEspNowFirmwareContract(networkNodes, wirelessLinks) {
  if (!Array.isArray(networkNodes) || networkNodes.length < 2) return null;
  const coordinator = networkNodes.find((node) => node.role === "coordinator") || networkNodes[0];
  return {
    schemaVersion: "MakeableEspNowFirmwareContractV1",
    state: "ready",
    sourceGenerationEnabled: false,
    transport: "esp-now",
    topology: "encrypted-unicast-star",
    coordinatorNodeId: coordinator.id,
    nodes: networkNodes.map((node) => ({
      nodeId: node.id,
      role: node.role,
      controllerPartId: node.controllerPartId,
      carrierPartId: node.carrierPartId || null,
      peripheralPartIds: [...node.peripheralPartIds],
      runtimeIdentity: {
        macAddress: "discover-and-provision-at-runtime",
        credentialsEmbeddedInArtifact: false,
      },
    })),
    links: wirelessLinks.map((link) => ({
      id: link.id,
      fromNodeId: link.fromNodeId,
      toNodeId: link.toNodeId,
      direction: "bidirectional-command-telemetry",
      encrypted: true,
    })),
    radio: {
      wifiMustStartBeforeEspNowInit: true,
      channelPolicy: "all-nodes-explicitly-configured-to-one-shared-channel",
      interfacePolicy: "station-interface",
      peerRegistrationRequiredBeforeSend: true,
    },
    security: {
      mode: "ccmp-encrypted-unicast",
      keyProvisioning: "deployment-time-pmk-and-per-peer-lmk",
      secretsEmbeddedInArtifact: false,
      multicastEncryptionPermitted: false,
    },
    messageEnvelope: {
      version: 1,
      compatibilityPayloadMaximumBytes: ESP_NOW_COMPATIBILITY_PAYLOAD_BYTES,
      requiredFields: ["protocolVersion", "nodeId", "sequence", "messageType", "timestampMs", "payload"],
      messageTypes: ["telemetry", "command", "ack", "heartbeat", "fault"],
    },
    delivery: {
      applicationAcknowledgementRequired: true,
      acknowledgementTimeoutMs: 250,
      maximumRetries: 3,
      retryBackoffMs: [50, 125, 250],
      sequenceNumberRequired: true,
      duplicateSequenceDropRequired: true,
      sendCallbackIsNotApplicationDeliveryProof: true,
    },
    concurrency: {
      wifiCallbacksMayOnlyEnqueueWork: true,
      applicationProcessingRunsOutsideWifiCallback: true,
    },
    limits: {
      compilerMaximumNodes: ESP_NOW_DEFAULT_MAX_NODES,
      compilerMaximumEncryptedPeersPerCoordinator: ESP_NOW_DEFAULT_MAX_NODES - 1,
      failClosedWhenExceeded: true,
    },
  };
}

export function assertEspNowFirmwareContract(contract) {
  if (contract?.schemaVersion !== "MakeableEspNowFirmwareContractV1"
    || contract.state !== "ready"
    || contract.sourceGenerationEnabled !== false
    || contract.transport !== "esp-now"
    || contract.topology !== "encrypted-unicast-star") {
    throw new Error("espnow_transport_contract_identity_invalid");
  }
  if (!Array.isArray(contract.nodes)
    || contract.nodes.length < 2
    || contract.nodes.length > ESP_NOW_DEFAULT_MAX_NODES) {
    throw new Error(`espnow_transport_contract_node_count_invalid:${contract.nodes?.length || 0}`);
  }
  const nodeIds = contract.nodes.map((node) => node.nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("espnow_transport_contract_node_ids_not_unique");
  const coordinators = contract.nodes.filter((node) => node.role === "coordinator");
  if (coordinators.length !== 1 || coordinators[0].nodeId !== contract.coordinatorNodeId) {
    throw new Error("espnow_transport_contract_coordinator_invalid");
  }
  if (contract.nodes.some((node) => (
    node.runtimeIdentity?.macAddress !== "discover-and-provision-at-runtime"
    || node.runtimeIdentity?.credentialsEmbeddedInArtifact !== false
  ))) {
    throw new Error("espnow_transport_contract_runtime_identity_invalid");
  }
  if (!Array.isArray(contract.links) || contract.links.length !== contract.nodes.length - 1) {
    throw new Error("espnow_transport_contract_star_edge_count_invalid");
  }
  const peerIds = new Set(contract.nodes.filter((node) => node.role !== "coordinator").map((node) => node.nodeId));
  if (contract.links.some((link) => (
    link.fromNodeId !== contract.coordinatorNodeId
    || !peerIds.has(link.toNodeId)
    || link.encrypted !== true
  )) || new Set(contract.links.map((link) => link.toNodeId)).size !== peerIds.size) {
    throw new Error("espnow_transport_contract_star_edges_invalid");
  }
  if (contract.radio?.wifiMustStartBeforeEspNowInit !== true
    || contract.radio?.peerRegistrationRequiredBeforeSend !== true
    || contract.radio?.channelPolicy !== "all-nodes-explicitly-configured-to-one-shared-channel") {
    throw new Error("espnow_transport_contract_radio_policy_invalid");
  }
  if (contract.security?.mode !== "ccmp-encrypted-unicast"
    || contract.security?.secretsEmbeddedInArtifact !== false
    || contract.security?.multicastEncryptionPermitted !== false) {
    throw new Error("espnow_transport_contract_security_policy_invalid");
  }
  if (contract.messageEnvelope?.compatibilityPayloadMaximumBytes !== ESP_NOW_COMPATIBILITY_PAYLOAD_BYTES
    || contract.delivery?.applicationAcknowledgementRequired !== true
    || contract.delivery?.sequenceNumberRequired !== true
    || contract.delivery?.duplicateSequenceDropRequired !== true
    || contract.delivery?.sendCallbackIsNotApplicationDeliveryProof !== true) {
    throw new Error("espnow_transport_contract_delivery_policy_invalid");
  }
  if (contract.concurrency?.wifiCallbacksMayOnlyEnqueueWork !== true
    || contract.concurrency?.applicationProcessingRunsOutsideWifiCallback !== true) {
    throw new Error("espnow_transport_contract_callback_policy_invalid");
  }
  return true;
}

function arrangeNodes(nodes) {
  const local = nodes.map((node) => ({ node, placement: node.placement, bounds: placementBounds(node.placement) }));
  const columns = Math.min(3, Math.max(2, Math.ceil(Math.sqrt(nodes.length))));
  const maximumWidth = Math.max(...local.map((entry) => span(entry.bounds, 0)));
  const maximumHeight = Math.max(...local.map((entry) => span(entry.bounds, 1)));
  const horizontalPitch = maximumWidth + 0.09;
  const verticalPitch = maximumHeight + 0.09;

  return local.map((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const center = boundsCenter(entry.bounds);
    const targetCenter = [column * horizontalPitch, -row * verticalPitch, center[2]];
    const offset = targetCenter.map((value, axis) => value - center[axis]);
    return {
      node: entry.node,
      offset,
      placement: translatePlacement(entry.placement, offset),
    };
  });
}

function mergeGraphs(arranged, networkNodes, wirelessLinks) {
  const graphs = arranged.map((entry) => entry.node.graph);
  const invariantNames = [...new Set(graphs.flatMap((graph) => Object.keys(graph.invariants || {})))];
  const invariants = Object.fromEntries(invariantNames.map((name) => [
    name,
    graphs.every((graph) => graph.invariants?.[name] === true),
  ]));
  return {
    schemaVersion: "MakeableElectricalNetworkGraphV1",
    state: "ready",
    controllerPartId: networkNodes[0].controllerPartId,
    carrierPartId: networkNodes[0].carrierPartId || null,
    controllerPartIds: networkNodes.map((node) => node.controllerPartId),
    carrierPartIds: networkNodes.map((node) => node.carrierPartId).filter(Boolean),
    peripheralPartIds: networkNodes.flatMap((node) => node.peripheralPartIds),
    nodes: networkNodes.map((node, index) => ({
      ...node,
      electricalGraph: graphs[index],
    })),
    nets: graphs.flatMap((graph) => graph.nets || []),
    connections: graphs.flatMap((graph) => graph.connections || []),
    subcomponents: graphs.flatMap((graph) => graph.subcomponents || []),
    wirelessLinks,
    invariants: {
      ...invariants,
      nodeGraphsReady: graphs.every((graph) => graph.state === "ready"),
      espNowTopologyValid: wirelessLinks.length === networkNodes.length - 1,
      wirelessLinksExcludedFromPhysicalNets: wirelessLinks.every((link) => (
        !graphs.some((graph) => (graph.connections || []).some((connection) => connection.id === link.id))
      )),
      encryptedPeerLimitValid: networkNodes.length <= ESP_NOW_DEFAULT_MAX_NODES,
    },
  };
}

function mergePlacements(arranged, graph, networkNodes, wirelessLinks) {
  const placements = arranged.map((entry) => entry.placement);
  const placement = {
    schemaVersion: "MakeableNetworkPlacementRoutingContractV1",
    state: "ready",
    circuitOnly: true,
    parts: placements.flatMap((entry) => entry.parts || []),
    keepouts: placements.flatMap((entry) => entry.keepouts || []),
    connections: graph.connections,
    subcomponents: placements.flatMap((entry) => entry.subcomponents || []),
    routes: placements.flatMap((entry) => entry.routes || []),
    rigidMates: placements.flatMap((entry) => entry.rigidMates || []),
    deformableHarnesses: placements.flatMap((entry) => entry.deformableHarnesses || []),
    hiddenCablePartIds: [...new Set(placements.flatMap((entry) => entry.hiddenCablePartIds || []))].sort(),
    routingMode: "logical-guide",
    networkNodes,
    wirelessLinks,
  };
  placement.fingerprint = fingerprint({
    parts: placement.parts,
    routes: placement.routes,
    networkNodes,
    wirelessLinks,
  });
  return placement;
}

function translatePlacement(placement, offset) {
  const translatePoint = (point) => point?.map((value, axis) => value + offset[axis]);
  const translateBounds = (bounds) => bounds ? {
    min: translatePoint(bounds.min),
    max: translatePoint(bounds.max),
  } : bounds;
  const translateEndpoint = (endpoint) => endpoint ? {
    ...endpoint,
    ...(Array.isArray(endpoint.position) ? { position: translatePoint(endpoint.position) } : {}),
  } : endpoint;
  return {
    ...placement,
    parts: (placement.parts || []).map((part) => ({
      ...part,
      translation: translatePoint(part.translation),
      worldBounds: translateBounds(part.worldBounds),
    })),
    keepouts: (placement.keepouts || []).map((keepout) => ({
      ...keepout,
      bounds: translateBounds(keepout.bounds),
    })),
    routes: (placement.routes || []).map((route) => ({
      ...route,
      points: (route.points || []).map(translatePoint),
      fromEndpoint: translateEndpoint(route.fromEndpoint),
      toEndpoint: translateEndpoint(route.toEndpoint),
    })),
  };
}

function networkNodeRecord(node, role, offset) {
  return {
    id: node.id,
    role,
    controllerPartId: node.controllerPartId,
    carrierPartId: node.carrierPartId || null,
    peripheralPartIds: [...(node.peripheralPartIds || [])],
    partIds: (node.instances || []).map((part) => part.id),
    offset,
  };
}

function wirelessLink(fromNode, toNode, fromPlacement, toPlacement) {
  const from = partCenter(fromPlacement, fromNode.controllerPartId);
  const to = partCenter(toPlacement, toNode.controllerPartId);
  const lift = Math.max(from[2], to[2]) + 0.045;
  return {
    id: `espnow:${fromNode.id}:${toNode.id}`,
    protocol: "ESP-NOW",
    connectionMode: "wireless-protocol-link",
    physicalConductor: false,
    fromNodeId: fromNode.id,
    toNodeId: toNode.id,
    fromPartId: fromNode.controllerPartId,
    toPartId: toNode.controllerPartId,
    points: [
      [from[0], from[1], Math.max(from[2] + 0.012, lift - 0.02)],
      [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, lift],
      [to[0], to[1], Math.max(to[2] + 0.012, lift - 0.02)],
    ],
    visualStyle: "cyan-dashed-radio-arc",
  };
}

function partCenter(placement, partId) {
  const part = (placement.parts || []).find((entry) => entry.id === partId);
  if (!part?.worldBounds) throw new Error(`espnow_controller_placement_missing:${partId}`);
  return boundsCenter(part.worldBounds);
}

function placementBounds(placement) {
  const bounds = (placement.parts || [])
    .filter((part) => part.role !== "cable" && part.worldBounds)
    .map((part) => part.worldBounds);
  if (!bounds.length) throw new Error("prompt2circuit_network_node_bounds_missing");
  return {
    min: [0, 1, 2].map((axis) => Math.min(...bounds.map((entry) => entry.min[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...bounds.map((entry) => entry.max[axis]))),
  };
}

function boundsCenter(bounds) {
  return [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
}

function span(bounds, axis) {
  return bounds.max[axis] - bounds.min[axis];
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
