const DEFAULT_FDM_RULES = {
  nozzleMm: 0.4,
  wallThicknessMm: 2.2,
  minWallThicknessMm: 2.0,
  maxWallThicknessMm: 2.4,
  movingClearanceMm: 0.5,
  internalClearanceMm: 3.0,
  connectorBackClearanceMm: 7.0,
  wireBendRoomMm: 10.0,
  rootFilletMm: 1.2,
  clipTaperDegrees: 8,
  lugDiameterMm: 5.0,
};

const PROFILE_DEFINITIONS = [
  {
    id: "fs90r-paired-wheel-kit",
    match: /fs90r.*(?:with wheels|wheels.*pack|servos with wheels)/i,
    // Two FS90R bodies mounted with their output shafts opposed. The solved
    // envelope is deliberately conservative; the wheels remain external.
    body: dims(55.4, 22.5, 12.1),
    mountingHoles: [],
    actuators: [
      {
        type: "paired-drive-wheels",
        count: 2,
        wheelDiameterMm: 60.0,
        tireWidthMm: 8.0,
        outputSpline: "21T, 4.86 mm",
      },
    ],
    keepouts: [
      { type: "servo-lead-bend", face: "rear", widthMm: 24.0, depthMm: 10.0, heightMm: 8.0 },
    ],
    pinOrientation: "two factory-attached 250 mm three-wire female servo plugs; orange signal, red 4.8-6 V, brown ground",
    sourceUrl: "https://www.feetechrc.com/48v-13kg-analog-continuous-rudder-machine.html",
    checkedDate: "2026-08-24",
    confidence: "high",
  },
  {
    id: "fs90r-single-servo",
    match: /fs90r/i,
    body: dims(22.5, 12.1, 27.7),
    mountingHoles: [],
    actuators: [
      {
        type: "continuous-servo-shaft",
        count: 1,
        outputSpline: "21T, 4.86 mm",
      },
    ],
    keepouts: [
      { type: "servo-lead-bend", face: "rear", widthMm: 12.0, depthMm: 10.0, heightMm: 8.0 },
    ],
    pinOrientation: "factory-attached 250 mm three-wire female servo plug; orange signal, red 4.8-6 V, brown ground",
    sourceUrl: "https://www.feetechrc.com/48v-13kg-analog-continuous-rudder-machine.html",
    checkedDate: "2026-08-24",
    confidence: "high",
  },
  {
    id: "dupont-2p-terminated-cable",
    match: /(?:dupont.*2p|2p.*dupont)/i,
    // Flexible cable is internal-only. The rigid geometry is the 2-position
    // 2.54 mm housing; cable length is tracked separately from enclosure fit.
    body: dims(5.1, 14.0, 2.6),
    mountingHoles: [],
    cable: {
      conductors: 2,
      pitchMm: 2.54,
      flexible: true,
    },
    keepouts: [
      { type: "cable-bend", face: "rear", widthMm: 6.0, depthMm: 10.0, heightMm: 5.0 },
    ],
    visiblePolicy: "internal-only",
    visibleOmissionReason: "Factory-terminated Dupont cable remains internal and requires no exterior opening.",
    pinOrientation: "factory-crimped two-position 2.54 mm Dupont housings; preserve the exact selected end genders",
    sourceUrl: "https://www.amazon.com/dp/B0B8Z23NWX?th=1",
    checkedDate: "2026-08-24",
    confidence: "high",
  },
  {
    id: "ssd1309-242-oled",
    match: /2\.42.*oled|ssd1309/i,
    body: dims(71, 43, 6),
    activeDisplayArea: dims2(55.0, 27.5),
    mountingHoles: cornerHoles(64, 36, 2.2),
    pinOrientation: "factory-soldered male header on lower board edge",
    sourceUrl: "https://www.waveshare.com/wiki/2.42inch_OLED_Module",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "ssd1306-096-oled",
    match: /0\.96.*oled|128x64|blue screen|white screen/i,
    body: dims(27.8, 27.3, 5.5),
    activeDisplayArea: dims2(21.7, 10.9),
    mountingHoles: cornerHoles(23.0, 23.0, 2.0),
    pinOrientation: "factory-soldered male header on lower board edge",
    sourceUrl: "https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "ssd1306-091-oled",
    match: /0\.91.*oled|0\.91-inch.*display|ssd1306.*pre-soldered/i,
    body: dims(38.0, 12.0, 5.0),
    activeDisplayArea: dims2(22.7, 5.6),
    mountingHoles: cornerHoles(33.0, 7.0, 2.0),
    pinOrientation: "factory-soldered male header on lower long edge",
    sourceUrl: "https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "lcd1602-keypad",
    match: /16x2|lc1602|1602.*keypad/i,
    body: dims(80.0, 58.0, 17.0),
    activeDisplayArea: dims2(64.5, 14.5),
    mountingHoles: cornerHoles(75.0, 53.0, 3.0),
    pinOrientation: "factory-soldered male header along rear board edge",
    sourceUrl: "https://www.lcd-module.de/eng/pdf/doma/dip162-de.pdf",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
  {
    id: "xiao-esp32",
    match: /xiao esp32/i,
    body: dims(21.0, 17.5, 7.0),
    mountingHoles: [],
    ports: [
      {
        type: "usb-c",
        face: "rear",
        cutout: dims2(9.4, 3.8),
        keepout: dims(11.0, 7.0, 5.0),
      },
    ],
    keepouts: [
      { type: "antenna", face: "top-edge", widthMm: 17.5, depthMm: 6.0, heightMm: 5.0 },
      { type: "header-service", face: "bottom", widthMm: 21.0, depthMm: 17.5, heightMm: 9.0 },
    ],
    pinOrientation: "two factory-soldered 2.54 mm male header rows down along the long sides",
    sourceUrl: "https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/",
    checkedDate: "2026-08-21",
    confidence: "high",
  },
  {
    id: "thing-plus-esp32",
    match: /thing plus.*esp32/i,
    body: dims(58.4, 22.9, 8.0),
    mountingHoles: cornerHoles(50.8, 17.8, 2.6),
    ports: [
      {
        type: "usb-c",
        face: "rear",
        cutout: dims2(9.4, 3.8),
        keepout: dims(11.0, 8.0, 5.5),
      },
      {
        type: "jst-lipo",
        face: "side",
        cutout: dims2(7.0, 4.0),
        keepout: dims(9.0, 10.0, 6.0),
      },
    ],
    keepouts: [
      { type: "antenna", face: "board-end", widthMm: 22.9, depthMm: 7.0, heightMm: 5.0 },
      { type: "cable-bend", face: "rear", widthMm: 18.0, depthMm: 12.0, heightMm: 8.0 },
    ],
    pinOrientation: "factory-soldered male header rows on the Feather-style long edges",
    sourceUrl: "https://learn.sparkfun.com/tutorials/esp32-thing-plus-hookup-guide",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "esp32-s3-mini",
    match: /esp32-s3.*mini|s3 mini/i,
    body: dims(41.0, 20.0, 8.0),
    mountingHoles: [],
    ports: [
      {
        type: "usb-c",
        face: "rear",
        cutout: dims2(9.4, 3.8),
        keepout: dims(11.0, 8.0, 5.5),
      },
    ],
    keepouts: [
      { type: "antenna", face: "board-end", widthMm: 20.0, depthMm: 7.0, heightMm: 5.0 },
    ],
    pinOrientation: "factory-soldered male header rows along both sides",
    sourceUrl: "https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
  {
    id: "esp32-camera-board",
    match: /camera|ov3660|ov5640|thermal imaging/i,
    body: dims(56.0, 32.0, 13.0),
    mountingHoles: cornerHoles(50.0, 26.0, 2.2),
    ports: [
      {
        type: "usb-c",
        face: "rear",
        cutout: dims2(9.4, 3.8),
        keepout: dims(11.0, 8.0, 5.5),
      },
    ],
    sensorApertures: [
      { type: "camera-lens", shape: "circle", diameterMm: 8.0, lineOfSightMm: 25.0 },
    ],
    keepouts: [
      { type: "lens-clearance", face: "front", widthMm: 14.0, depthMm: 10.0, heightMm: 8.0 },
      { type: "antenna", face: "board-end", widthMm: 22.0, depthMm: 8.0, heightMm: 6.0 },
    ],
    pinOrientation: "factory-soldered male headers down; camera lens faces front aperture",
    sourceUrl: "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-eye/user_guide.html",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
  {
    id: "bme280-bmp280",
    match: /bme280|bmp280|bmp180|sht31|temperature|humidity|pressure/i,
    body: dims(15.0, 12.0, 5.0),
    mountingHoles: [{ xMm: 2.0, yMm: 2.0, diameterMm: 2.0 }],
    sensorApertures: [
      { type: "environment-vent", shape: "slot-array", widthMm: 12.0, heightMm: 5.0, lineOfSightMm: 0 },
    ],
    pinOrientation: "factory-soldered male header on one short edge",
    sourceUrl: "https://www.bosch-sensortec.com/products/environmental-sensors/humidity-sensors-bme280/",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "bh1750-light",
    match: /bh1750|ambient light|lux/i,
    body: dims(18.5, 13.7, 5.0),
    mountingHoles: [{ xMm: 2.2, yMm: 2.2, diameterMm: 2.0 }],
    sensorApertures: [
      { type: "light-window", shape: "circle", diameterMm: 5.0, lineOfSightMm: 20.0 },
    ],
    pinOrientation: "factory-soldered male header on one edge",
    sourceUrl: "https://www.mouser.com/datasheet/2/348/bh1750fvi-e-186247.pdf",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "vl53l1x-tof",
    match: /vl53l1x|tof|time.of.flight|distance sensor/i,
    body: dims(25.0, 10.0, 5.5),
    mountingHoles: cornerHoles(20.0, 5.0, 2.0),
    sensorApertures: [
      { type: "tof-window", shape: "rounded-square", widthMm: 5.0, heightMm: 5.0, lineOfSightMm: 60.0 },
    ],
    pinOrientation: "factory-soldered male header on one short edge; optical package faces front aperture",
    sourceUrl: "https://www.st.com/resource/en/datasheet/vl53l1x.pdf",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "ld2410c-radar",
    match: /ld2410|radar|presence/i,
    body: dims(22.0, 12.5, 6.0),
    mountingHoles: [],
    sensorApertures: [
      { type: "radar-window", shape: "uncovered-plastic-front", widthMm: 18.0, heightMm: 9.0, lineOfSightMm: 80.0 },
    ],
    keepouts: [
      { type: "antenna-clear-front", face: "front", widthMm: 22.0, depthMm: 8.0, heightMm: 8.0 },
    ],
    pinOrientation: "factory-soldered 5-pin male header down or rearward; radar face aims through front wall",
    sourceUrl: "https://www.hlktech.net/index.php?id=1096",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "rain-water-level",
    match: /rain|water level|liquid|leak/i,
    body: dims(60.0, 20.0, 5.0),
    sensorApertures: [
      { type: "external-probe-excluded", shape: "none", widthMm: 0, heightMm: 0, lineOfSightMm: 0 },
    ],
    pinOrientation: "factory-soldered 3-pin male header on the end",
    sourceUrl: "https://www.amazon.com/Sensor-Module-Surface-Detection-Raspberry/dp/B09J2NK21Y",
    checkedDate: "2026-08-21",
    confidence: "low",
    visiblePolicy: "internal-only",
    visibleOmissionReason: "water probes are not represented as decorative external hardware in concept renders",
  },
  {
    id: "ky040-rotary",
    match: /rotary encoder|ky-040|knob|potentiometer/i,
    body: dims(32.0, 19.0, 18.0),
    mountingHoles: [{ xMm: 3.0, yMm: 3.0, diameterMm: 2.2 }],
    controls: [
      { type: "rotary-shaft", cutoutDiameterMm: 7.2, knobEnvelopeMm: dims(18.0, 18.0, 12.0) },
    ],
    pinOrientation: "factory-soldered 5-pin male header on side edge",
    sourceUrl: "https://components101.com/modules/ky-040-rotary-encoder-pinout-features-datasheet-working-application-alternative",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "ttp223-touch",
    match: /touch sensor|ttp223|capacitive/i,
    body: dims(15.0, 11.0, 4.0),
    controls: [
      { type: "capacitive-touch-pad", cutoutDiameterMm: 0, markedAreaMm: dims2(12.0, 12.0) },
    ],
    pinOrientation: "factory-soldered 3-pin male header on one edge",
    sourceUrl: "https://datasheet.lcsc.com/lcsc/1810221811_Tontek-Design-Tech-TTP223-BA6_C80757.pdf",
    checkedDate: "2026-08-21",
    confidence: "medium",
  },
  {
    id: "keypad-4x4",
    match: /4x4.*keypad|matrix keypad/i,
    body: dims(70.0, 77.0, 10.0),
    controls: [
      { type: "keypad-face", markedAreaMm: dims2(64.0, 70.0) },
    ],
    pinOrientation: "factory-soldered I2C adapter header under keypad",
    sourceUrl: "https://www.ti.com/lit/an/slyt659/slyt659.pdf",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
  {
    id: "joystick-module",
    match: /joystick|ky-023/i,
    body: dims(34.0, 26.0, 32.0),
    controls: [
      { type: "joystick-stick", cutoutDiameterMm: 17.0, knobEnvelopeMm: dims(22.0, 22.0, 18.0) },
    ],
    pinOrientation: "factory-soldered 5-pin male header on edge",
    sourceUrl: "https://components101.com/modules/joystick-module",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
  {
    id: "rgb-led-module",
    match: /rgb.*led|led.*rgb|traffic light/i,
    body: dims(19.0, 15.0, 9.0),
    controls: [
      { type: "indicator-lens-opening", cutoutDiameterMm: 6.0 },
    ],
    pinOrientation: "factory-soldered male header on board edge",
    sourceUrl: "https://www.amazon.com/dp/B0BXKMGSG6",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
  {
    id: "buzzer-module",
    match: /buzzer|piezo|sounder/i,
    body: dims(23.0, 14.0, 12.0),
    controls: [
      { type: "sound-grille", markedAreaMm: dims2(12.0, 8.0) },
    ],
    pinOrientation: "factory-soldered male header on board edge",
    sourceUrl: "https://www.cuidevices.com/product/resource/cmt-1203-smt-tr.pdf",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
  {
    id: "microphone-sound",
    match: /microphone|sound sensor|ky-037/i,
    body: dims(36.0, 16.0, 12.0),
    sensorApertures: [
      { type: "microphone-port", shape: "circle", diameterMm: 3.0, lineOfSightMm: 0 },
    ],
    pinOrientation: "factory-soldered male header on board edge",
    sourceUrl: "https://www.amazon.com/SHILLEHTEK-Raspberry-Sensitivity-Microphone-Detection/dp/B0CN583K69",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
  {
    id: "reed-hall-magnetic",
    match: /reed|hall effect|magnetic/i,
    body: dims(32.0, 14.0, 8.0),
    sensorApertures: [
      { type: "magnetic-sensing-zone", shape: "hidden-under-wall", widthMm: 12.0, heightMm: 6.0, lineOfSightMm: 0 },
    ],
    pinOrientation: "factory-soldered male header on board edge",
    sourceUrl: "https://www.amazon.com/dp/B0FR4CNLPX",
    checkedDate: "2026-08-21",
    confidence: "low",
  },
];

const UNSUPPORTED_AFFORDANCE_PATTERNS = [
  /glass|acrylic|dome|cloche|bubble/i,
  /cat|dog|animal|pet figurine|figurine|mascot|sculpture|toy animal|creature/i,
  /breadboard|loose decorative wire/i,
  /battery|mains|wall plug|relay|pump|heater/i,
  /hc-?sr04|ultrasonic transducer|unsupported sensor/i,
  /extra port|barrel jack|ethernet|usb-a|hdmi|sd card/i,
];

export function componentGeometryForPart(part) {
  const profile = profileForPart(part);
  if (!profile) {
    return {
      partId: part?.id || "",
      name: clean(part?.name || part?.listingTitle || "Unknown part"),
      category: clean(part?.category || "unknown"),
      verified: false,
      visible: false,
      omittedReason: "No dimension-verified geometry profile is available for this selected catalog row.",
      sourceUrl: clean(part?.url || ""),
      checkedDate: clean(part?.checkedDate || ""),
      confidence: "none",
    };
  }

  return {
    partId: part?.id || "",
    profileId: profile.id,
    name: clean(part?.name || part?.listingTitle || profile.id),
    category: clean(part?.category || categoryFromProfile(profile)),
    subtype: clean(part?.subtype || ""),
    verified: true,
    visible: profile.visiblePolicy !== "internal-only",
    visiblePolicy: profile.visiblePolicy || "visible-if-affordance-needed",
    omittedReason: profile.visibleOmissionReason || "",
    body: clone(profile.body),
    activeDisplayArea: clone(profile.activeDisplayArea || null),
    mountingHoles: clone(profile.mountingHoles || []),
    ports: clone(profile.ports || []),
    keepouts: clone(profile.keepouts || []),
    sensorApertures: clone(profile.sensorApertures || []),
    controls: clone(profile.controls || []),
    actuators: clone(profile.actuators || []),
    cable: clone(profile.cable || null),
    pinOrientation: profile.pinOrientation,
    sourceUrl: clean(part?.url || profile.sourceUrl),
    dimensionSourceUrl: profile.sourceUrl,
    checkedDate: clean(part?.checkedDate || profile.checkedDate),
    confidence: profile.confidence,
  };
}

export function buildGeometryContract(input = {}) {
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const components = parts.map(componentGeometryForPart);
  const verifiedComponents = components.filter((component) => component.verified);
  const omittedComponents = components.filter((component) => !component.verified || component.visiblePolicy === "internal-only");
  const layout = solveLayout(verifiedComponents, input.options || {});
  const affordanceInput = [
    ...(Array.isArray(input.requestedAffordances) ? input.requestedAffordances : []),
    ...(Array.isArray(input.plan?.visibleHardwareCues) ? input.plan.visibleHardwareCues : []),
  ];
  const affordances = solveAffordances({
    components: verifiedComponents,
    placements: layout.placements,
    requestedAffordances: affordanceInput,
    wheelIntent: wantsWheels(input.idea),
  });
  const contract = {
    version: "makeable-geometry-contract-v1",
    createdAt: input.now ? new Date(input.now).toISOString() : new Date().toISOString(),
    idea: clean(input.idea || ""),
    fdm: clone(DEFAULT_FDM_RULES),
    components,
    visibleComponents: verifiedComponents.filter((component) => component.visible !== false),
    omittedComponents,
    enclosure: layout.enclosure,
    placements: layout.placements,
    visibleAffordances: affordances.visibleAffordances,
    cutouts: affordances.cutouts,
    unsupportedAffordanceCount: affordances.unsupportedAffordances.length + components.filter((component) => !component.verified).length,
    unsupportedAffordances: affordances.unsupportedAffordances,
    warnings: [
      ...omittedComponents.map((component) => `${component.name}: ${component.omittedReason || "omitted from visible prompt"}`),
      ...layout.warnings,
    ],
  };
  return {
    ...contract,
    validation: validateGeometryContract(contract),
  };
}

export function validateGeometryContract(contract) {
  const errors = [];
  const enclosure = contract?.enclosure;
  if (!enclosure?.innerAabb || !Array.isArray(contract?.placements)) {
    return { ok: false, errors: ["contract has no solved enclosure or placements"] };
  }

  for (const placement of contract.placements) {
    if (!containsAabb(enclosure.innerAabb, placement.requiredAabb)) {
      errors.push(`${placement.componentId} does not fit inside enclosure inner cavity and keepouts`);
    }
  }

  for (const cutout of contract.cutouts || []) {
    if (cutout.type === "display-window") {
      const component = contract.components.find((item) => item.partId === cutout.componentId);
      if (!component?.activeDisplayArea) {
        errors.push(`${cutout.componentId} has a display cutout without verified active display area`);
      } else if (
        cutout.widthMm > component.activeDisplayArea.widthMm
        || cutout.heightMm > component.activeDisplayArea.heightMm
      ) {
        errors.push(`${cutout.componentId} display cutout exceeds verified active display area`);
      }
    }

    if (cutout.requiresVerifiedComponent && !contract.components.some((item) => item.partId === cutout.componentId && item.verified)) {
      errors.push(`${cutout.type} cutout is not backed by a verified selected component`);
    }
  }

  for (const affordance of contract.visibleAffordances || []) {
    if (affordance.requiresVerifiedComponent && !contract.components.some((item) => item.partId === affordance.componentId && item.verified)) {
      errors.push(`${affordance.type} affordance is not backed by a verified selected component`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function formatIndustrialDesignPromptBlock(contract) {
  const lines = [];
  const enclosure = contract.enclosure;
  lines.push("Deterministic geometry contract:");
  lines.push(`- Enclosure outer envelope: ${fmt(enclosure.outer.widthMm)} W x ${fmt(enclosure.outer.depthMm)} D x ${fmt(enclosure.outer.heightMm)} H mm.`);
  lines.push(`- Inner cavity: ${fmt(enclosure.inner.widthMm)} W x ${fmt(enclosure.inner.depthMm)} D x ${fmt(enclosure.inner.heightMm)} H mm; wall thickness ${fmt(contract.fdm.wallThicknessMm)} mm.`);
  lines.push(`- Print profile: ${fmt(contract.fdm.nozzleMm)} mm nozzle, ${fmt(contract.fdm.minWallThicknessMm)}-${fmt(contract.fdm.maxWallThicknessMm)} mm walls, ${fmt(contract.fdm.movingClearanceMm)} mm snap clearance, concealed tapered cantilever clips, ${fmt(contract.fdm.rootFilletMm)} mm root fillets, locating lugs, horizontal shell split, print flat on the base, zero screws or threaded fasteners.`);
  lines.push("- Dimension-verified selected components:");
  for (const component of contract.components.filter((item) => item.verified)) {
    lines.push(`  - ${component.name}: body ${fmt(component.body.widthMm)} x ${fmt(component.body.depthMm)} x ${fmt(component.body.heightMm)} mm; pins ${component.pinOrientation}; source ${component.sourceUrl}; checked ${component.checkedDate}; confidence ${component.confidence}.`);
    for (const actuator of component.actuators || []) {
      if (actuator.type === "paired-drive-wheels") {
        if (wantsWheels(contract.idea)) {
          lines.push(`    - Paired external wheels: ${fmt(actuator.wheelDiameterMm)} mm diameter x ${fmt(actuator.tireWidthMm)} mm tire width; ${actuator.outputSpline} spline; keep both wheel sweep volumes unobstructed.`);
        } else {
          lines.push(`    - The listing includes optional wheels, but this idea is not wheeled: omit every wheel and use at most one continuous-servo output for the requested rotating linkage.`);
        }
      } else {
        lines.push(`    - Continuous-rotation output shaft: ${actuator.outputSpline}; do not invent a wheel or mechanism unless the selected listing includes it.`);
      }
    }
    if (component.cable) {
      lines.push(`    - Internal flexible cable: ${component.cable.conductors} conductors at ${fmt(component.cable.pitchMm)} mm pitch; preserve exact selected end genders and do not expose it decoratively.`);
    }
  }
  if (contract.components.some((item) => !item.verified)) {
    lines.push(`- ${contract.components.filter((item) => !item.verified).length} selected component(s) are dimension-unverified and must be hidden or omitted from visible exterior details.`);
  }
  lines.push("- Required hero-visible affordances backed by verified dimensions:");
  if (contract.visibleAffordances.length) {
    for (const affordance of contract.visibleAffordances) {
      lines.push(`  - ${affordance.label}`);
    }
  } else {
    lines.push("  - No hero-visible controls; keep the verified rear/underside power-programming opening completely outside the camera view.");
  }
  lines.push("- Cutouts and openings:");
  for (const cutout of contract.cutouts) {
    lines.push(`  - ${cutout.label}`);
  }
  lines.push("- Strict visibility rule: every visible port, sensor opening, display window, button, knob, light pipe, grille, lens, or cable opening must correspond to one of the verified component records above. Do not add any exterior feature for unverified or omitted parts.");
  lines.push("- Industrial design direction: project-specific silhouette, clean serviceable snap-fit seam, sensible display-to-body ratio, modest radii, rear/side/underside connector placement, zero screws, no fake text, no decorative generated components, and no unsupported extra hardware.");
  return lines.join("\n");
}

export function geometrySummaryForBuild(input = {}) {
  const contract = buildGeometryContract(input);
  return {
    contract,
    promptBlock: formatIndustrialDesignPromptBlock(contract),
  };
}

function solveLayout(components, options) {
  const fdm = { ...DEFAULT_FDM_RULES, ...(options.fdm || {}) };
  const wall = fdm.wallThicknessMm;
  const clearance = fdm.internalClearanceMm;
  const visibleComponents = components.filter((component) => component.visible !== false);
  const display = firstBy(components, (component) => component.activeDisplayArea);
  const controller = firstBy(components, (component) => /controller|storage|power/i.test(component.category));
  const frontFacing = components.filter((component) =>
    component.activeDisplayArea
    || component.sensorApertures?.length
    || component.controls?.length
  );
  const other = components.filter((component) => !frontFacing.includes(component) && component !== controller);

  const maxBodyWidth = Math.max(0, ...components.map((component) => component.body.widthMm));
  const frontWidth = Math.max(0, ...frontFacing.map((component) => component.body.widthMm));
  const totalArea = components.reduce((sum, component) => sum + component.body.widthMm * component.body.depthMm, 0);
  const displayWidthNeed = display?.activeDisplayArea
    ? display.activeDisplayArea.widthMm + 18
    : 0;
  const innerWidth = roundUp(Math.max(56, maxBodyWidth + 2 * clearance, frontWidth + 2 * clearance, displayWidthNeed, Math.sqrt(totalArea) + 24), 2);

  const ordered = [
    ...unique([display, ...frontFacing, controller, ...other].filter(Boolean)),
  ];
  const placements = [];
  let cursorY = wall + clearance;
  const innerStartX = wall;
  const innerStartY = wall;
  const centerX = innerStartX + innerWidth / 2;
  for (const component of ordered) {
    const pad = componentPad(component);
    const y = cursorY + pad.front + component.body.depthMm / 2;
    const z = wall + 1.5 + component.body.heightMm / 2;
    const bodyAabb = aabbFromCenter(centerX, y, z, component.body);
    const requiredAabb = expandAabb(bodyAabb, pad);
    placements.push({
      componentId: component.partId,
      profileId: component.profileId,
      name: component.name,
      role: geometryRole(component),
      bodyAabb,
      requiredAabb,
    });
    cursorY = requiredAabb.maxY + clearance;
  }

  const innerDepth = roundUp(Math.max(46, cursorY - innerStartY + fdm.wireBendRoomMm), 2);
  const innerHeight = roundUp(Math.max(28, ...components.map((component) => component.body.heightMm + 10)), 2);
  const outer = {
    widthMm: round1(innerWidth + 2 * wall),
    depthMm: round1(innerDepth + 2 * wall),
    heightMm: round1(innerHeight + wall + 2.0),
  };
  const inner = {
    widthMm: round1(innerWidth),
    depthMm: round1(innerDepth),
    heightMm: round1(innerHeight),
  };
  const innerAabb = {
    minX: wall,
    minY: wall,
    minZ: wall,
    maxX: wall + innerWidth,
    maxY: wall + innerDepth,
    maxZ: wall + innerHeight,
  };

  const checkedPlacements = placements.map((placement) => ({
    ...placement,
    requiredAabb: clampPlacementIfNeeded(placement.requiredAabb, innerAabb),
    bodyAabb: clampPlacementIfNeeded(placement.bodyAabb, innerAabb),
  }));

  return {
    enclosure: {
      outer,
      inner,
      innerAabb,
      wallThicknessMm: wall,
      splitLine: "horizontal split 7 mm above base with tapered snap hooks loaded in XY, not across weak Z layers",
      snapFit: {
        movingClearanceMm: fdm.movingClearanceMm,
        clipTaperDegrees: fdm.clipTaperDegrees,
        rootFilletMm: fdm.rootFilletMm,
        locatingLugs: "four 5 mm locating lugs inside the base, away from connector keepouts",
      },
      printOrientation: "base flat on build plate; lid prints face-up; clips flex parallel to layer lines",
    },
    placements: checkedPlacements,
    warnings: visibleComponents.length ? [] : ["No dimension-verified visible components are available."],
  };
}

function solveAffordances({ components, placements, requestedAffordances, wheelIntent = false }) {
  const visibleAffordances = [];
  const cutouts = [];
  const unsupportedAffordances = requestedAffordances
    .map((item) => clean(item))
    .filter(Boolean)
    .filter((item) => UNSUPPORTED_AFFORDANCE_PATTERNS.some((pattern) => pattern.test(item)));

  for (const component of components) {
    if (component.visible === false) continue;
    const placement = placements.find((item) => item.componentId === component.partId);
    if (!placement) continue;

    if (component.activeDisplayArea) {
      const width = round1(Math.max(1, component.activeDisplayArea.widthMm - 0.4));
      const height = round1(Math.max(1, component.activeDisplayArea.heightMm - 0.4));
      const bezel = round1(Math.max(3, (component.body.widthMm - width) / 2));
      cutouts.push({
        type: "display-window",
        componentId: component.partId,
        widthMm: width,
        heightMm: height,
        face: "front",
        requiresVerifiedComponent: true,
        label: `${component.name} display window ${fmt(width)} x ${fmt(height)} mm, capped below active area ${fmt(component.activeDisplayArea.widthMm)} x ${fmt(component.activeDisplayArea.heightMm)} mm with about ${fmt(bezel)} mm bezel.`,
      });
      visibleAffordances.push({
        type: "display",
        componentId: component.partId,
        requiresVerifiedComponent: true,
        label: `flush display face from ${component.name}; display-to-body ratio solved from verified active area, not enlarged beyond the panel.`,
      });
    }

    for (const port of component.ports || []) {
      if (port.type !== "usb-c" && port.type !== "jst-lipo") continue;
      cutouts.push({
        type: `${port.type}-port`,
        componentId: component.partId,
        widthMm: round1(port.cutout.widthMm),
        heightMm: round1(port.cutout.heightMm),
        face: port.face,
        requiresVerifiedComponent: true,
        label: `${component.name} ${port.type.toUpperCase()} concealed rear or underside cutout ${fmt(port.cutout.widthMm)} x ${fmt(port.cutout.heightMm)} mm with ${fmt(port.keepout.depthMm)} mm cable room; this service opening must be completely outside the hero camera view.`,
      });
    }

    for (const aperture of component.sensorApertures || []) {
      if (aperture.shape === "none" || aperture.shape === "hidden-under-wall") continue;
      const labelSize = aperture.diameterMm
        ? `${fmt(aperture.diameterMm)} mm diameter`
        : `${fmt(aperture.widthMm)} x ${fmt(aperture.heightMm)} mm`;
      cutouts.push({
        type: "sensor-aperture",
        componentId: component.partId,
        widthMm: round1(aperture.widthMm || aperture.diameterMm),
        heightMm: round1(aperture.heightMm || aperture.diameterMm),
        face: "front",
        requiresVerifiedComponent: true,
        label: `${component.name} ${aperture.type} front aperture ${labelSize}, line of sight ${fmt(aperture.lineOfSightMm)} mm.`,
      });
      visibleAffordances.push({
        type: aperture.type,
        componentId: component.partId,
        requiresVerifiedComponent: true,
        label: `${aperture.type} aligned to ${component.name}, with no decorative fake sensor windows.`,
      });
    }

    for (const control of component.controls || []) {
      if (control.type === "rotary-shaft" || control.type === "joystick-stick") {
        const diameter = round1(control.cutoutDiameterMm);
        cutouts.push({
          type: `${control.type}-cutout`,
          componentId: component.partId,
          diameterMm: diameter,
          face: "front",
          requiresVerifiedComponent: true,
          label: `${component.name} ${control.type} panel opening ${fmt(diameter)} mm diameter with ${fmt(DEFAULT_FDM_RULES.movingClearanceMm)} mm moving clearance.`,
        });
        visibleAffordances.push({
          type: control.type,
          componentId: component.partId,
          requiresVerifiedComponent: true,
          label: `${control.type} backed by ${component.name}; shaft opening only, not an invented control.`,
        });
      } else if (control.type === "capacitive-touch-pad") {
        cutouts.push({
          type: "touch-area",
          componentId: component.partId,
          widthMm: round1(control.markedAreaMm.widthMm),
          heightMm: round1(control.markedAreaMm.heightMm),
          face: "front",
          requiresVerifiedComponent: true,
          label: `${component.name} marked touch area ${fmt(control.markedAreaMm.widthMm)} x ${fmt(control.markedAreaMm.heightMm)} mm with no through-hole button.`,
        });
        visibleAffordances.push({
          type: "touch-pad",
          componentId: component.partId,
          requiresVerifiedComponent: true,
          label: `subtle touch target backed by ${component.name}; no mechanical button unless selected.`,
        });
      } else if (control.type === "indicator-lens-opening" || control.type === "sound-grille" || control.type === "keypad-face") {
        const size = control.cutoutDiameterMm
          ? `${fmt(control.cutoutDiameterMm)} mm diameter`
          : `${fmt(control.markedAreaMm.widthMm)} x ${fmt(control.markedAreaMm.heightMm)} mm`;
        cutouts.push({
          type: control.type,
          componentId: component.partId,
          widthMm: round1(control.markedAreaMm?.widthMm || control.cutoutDiameterMm),
          heightMm: round1(control.markedAreaMm?.heightMm || control.cutoutDiameterMm),
          face: "front",
          requiresVerifiedComponent: true,
          label: `${component.name} ${control.type} ${size}.`,
        });
        visibleAffordances.push({
          type: control.type,
          componentId: component.partId,
          requiresVerifiedComponent: true,
          label: `${control.type} backed by ${component.name}; no additional output features.`,
        });
      }
    }

    for (const actuator of component.actuators || []) {
      if (actuator.type === "paired-drive-wheels") {
        if (!wheelIntent) {
          cutouts.push({
            type: "servo-shaft-opening",
            componentId: component.partId,
            diameterMm: 6.0,
            face: "side",
            requiresVerifiedComponent: true,
            label: `${component.name} one continuous-servo shaft opening 6 mm diameter for the verified ${actuator.outputSpline} output; omit the listing's wheels and do not add a drivetrain.`,
          });
          visibleAffordances.push({
            type: "continuous-servo-shaft",
            componentId: component.partId,
            requiresVerifiedComponent: true,
            label: `one continuous-rotation output shaft backed by ${component.name}; omit every wheel and show no unselected mechanism.`,
          });
          continue;
        }
        for (const face of ["left", "right"]) {
          cutouts.push({
            type: "servo-axle-opening",
            componentId: component.partId,
            diameterMm: 6.0,
            face,
            requiresVerifiedComponent: true,
            label: `${component.name} ${face} axle opening 6 mm diameter for the verified ${actuator.outputSpline} FS90R output, with ${fmt(DEFAULT_FDM_RULES.movingClearanceMm)} mm moving clearance.`,
          });
        }
        visibleAffordances.push({
          type: "paired-drive-wheels",
          componentId: component.partId,
          requiresVerifiedComponent: true,
          label: `two verified ${fmt(actuator.wheelDiameterMm)} mm wheels outside the shell, aligned to the paired FS90R shafts with unobstructed wheel sweep.`,
        });
      } else if (actuator.type === "continuous-servo-shaft") {
        cutouts.push({
          type: "servo-shaft-opening",
          componentId: component.partId,
          diameterMm: 6.0,
          face: "side",
          requiresVerifiedComponent: true,
          label: `${component.name} shaft opening 6 mm diameter for the verified ${actuator.outputSpline} output; no unselected wheel or linkage.`,
        });
        visibleAffordances.push({
          type: "continuous-servo-shaft",
          componentId: component.partId,
          requiresVerifiedComponent: true,
          label: `continuous-rotation output shaft backed by ${component.name}; no unselected mechanism.`,
        });
      }
    }
  }

  return {
    visibleAffordances: dedupeByLabel(visibleAffordances),
    cutouts: dedupeByLabel(cutouts),
    unsupportedAffordances,
  };
}

function wantsWheels(idea) {
  return /\bcar\b|rover|wheeled|wheel|vacuum|floor robot|trash sort/i.test(String(idea || ""));
}

function profileForPart(part) {
  const text = `${part?.name || ""} ${part?.subtype || ""} ${part?.listingTitle || ""}`.toLowerCase();
  return PROFILE_DEFINITIONS.find((profile) => profile.match.test(text)) || null;
}

function componentPad(component) {
  const pad = {
    left: DEFAULT_FDM_RULES.internalClearanceMm,
    right: DEFAULT_FDM_RULES.internalClearanceMm,
    front: DEFAULT_FDM_RULES.internalClearanceMm,
    back: DEFAULT_FDM_RULES.internalClearanceMm,
    top: DEFAULT_FDM_RULES.internalClearanceMm,
    bottom: 1.0,
  };
  for (const keepout of component.keepouts || []) {
    if (/front|antenna-clear-front/.test(keepout.face || keepout.type)) pad.front = Math.max(pad.front, keepout.depthMm || 0);
    if (/rear|cable|connector/.test(keepout.face || keepout.type)) pad.back = Math.max(pad.back, keepout.depthMm || DEFAULT_FDM_RULES.connectorBackClearanceMm);
    if (/side|edge/.test(keepout.face || keepout.type)) {
      pad.left = Math.max(pad.left, (keepout.widthMm || 0) / 2);
      pad.right = Math.max(pad.right, (keepout.widthMm || 0) / 2);
    }
    pad.top = Math.max(pad.top, keepout.heightMm || pad.top);
  }
  for (const port of component.ports || []) {
    pad.back = Math.max(pad.back, port.keepout?.depthMm || DEFAULT_FDM_RULES.connectorBackClearanceMm);
    pad.top = Math.max(pad.top, port.keepout?.heightMm || pad.top);
  }
  return pad;
}

function geometryRole(component) {
  if (component.actuators?.length) return "actuator";
  if (component.activeDisplayArea) return "display";
  if (component.controls?.length) return "control-output";
  if (component.sensorApertures?.length) return "sensor";
  if (/controller|storage|power/i.test(component.category)) return "controller";
  return "internal-module";
}

function categoryFromProfile(profile) {
  if (/oled|lcd|display/.test(profile.id)) return "display";
  if (/xiao|esp32|thing/.test(profile.id)) return "controller";
  if (/rotary|touch|keypad|joystick/.test(profile.id)) return "input";
  if (/led|buzzer/.test(profile.id)) return "output";
  return "sensor";
}

function aabbFromCenter(centerX, centerY, centerZ, box) {
  return {
    minX: round1(centerX - box.widthMm / 2),
    maxX: round1(centerX + box.widthMm / 2),
    minY: round1(centerY - box.depthMm / 2),
    maxY: round1(centerY + box.depthMm / 2),
    minZ: round1(centerZ - box.heightMm / 2),
    maxZ: round1(centerZ + box.heightMm / 2),
  };
}

function expandAabb(box, pad) {
  return {
    minX: round1(box.minX - pad.left),
    maxX: round1(box.maxX + pad.right),
    minY: round1(box.minY - pad.front),
    maxY: round1(box.maxY + pad.back),
    minZ: round1(box.minZ - pad.bottom),
    maxZ: round1(box.maxZ + pad.top),
  };
}

function containsAabb(container, item) {
  return item.minX >= container.minX
    && item.maxX <= container.maxX
    && item.minY >= container.minY
    && item.maxY <= container.maxY
    && item.minZ >= container.minZ
    && item.maxZ <= container.maxZ;
}

function clampPlacementIfNeeded(box, container) {
  const offsetX = Math.max(0, container.minX - box.minX) - Math.max(0, box.maxX - container.maxX);
  const offsetY = Math.max(0, container.minY - box.minY) - Math.max(0, box.maxY - container.maxY);
  const offsetZ = Math.max(0, container.minZ - box.minZ) - Math.max(0, box.maxZ - container.maxZ);
  if (!offsetX && !offsetY && !offsetZ) return box;
  return {
    minX: round1(box.minX + offsetX),
    maxX: round1(box.maxX + offsetX),
    minY: round1(box.minY + offsetY),
    maxY: round1(box.maxY + offsetY),
    minZ: round1(box.minZ + offsetZ),
    maxZ: round1(box.maxZ + offsetZ),
  };
}

function dims(widthMm, depthMm, heightMm) {
  return { widthMm, depthMm, heightMm };
}

function dims2(widthMm, heightMm) {
  return { widthMm, heightMm };
}

function cornerHoles(widthSpanMm, depthSpanMm, diameterMm) {
  const x = widthSpanMm / 2;
  const y = depthSpanMm / 2;
  return [
    { xMm: -x, yMm: -y, diameterMm },
    { xMm: x, yMm: -y, diameterMm },
    { xMm: -x, yMm: y, diameterMm },
    { xMm: x, yMm: y, diameterMm },
  ];
}

function firstBy(items, predicate) {
  return items.find((item) => Boolean(item && predicate(item))) || null;
}

function unique(items) {
  return [...new Set(items)];
}

function dedupeByLabel(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

function roundUp(value, increment) {
  return Math.ceil(value / increment) * increment;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function fmt(value) {
  return Number(value).toFixed(Number.isInteger(Number(value)) ? 0 : 1);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
