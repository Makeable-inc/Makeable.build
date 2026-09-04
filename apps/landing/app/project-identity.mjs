const GENERIC_TITLES = /^(?:no[- ]build match(?:\b.*)?|minimal starter build|build match|project build|untitled build)$/i;
const GENERIC_SUMMARIES = /(?:a simple .+ you can make for everyday use\. it keeps one helpful task easy to see and use\.?|simple starter build)/i;
const IMPLEMENTATION_TITLE_TERMS = /\b(?:ESP32(?:-(?:C3|C6|S3))?|OLED|TFT|LCD|SCD[- ]?41)\b/i;
const ROBOTIC_SUMMARY_LEAD = /^(?:a|an|the)\s+(?:compact|small|tabletop|usb-c(?: powered)?|esp32(?:-[a-z0-9]+)?(?:-based)?|doorway|quiet|silent|tiny|closed|opaque)\b/i;
const INCOMPLETE_SUMMARY_END = /(?:,\.|\b(?:a|an|as|for|from|in|into|of|on|rather than|the|to|with|without)[,.])$/i;
const PROMPT_PREFIX = /^(?:(?:i m|i am|i want to|i want yto|i wanna|i would like to|please)\s+)?(?:build(?:ing)?|make|create|design)(?:\s+me)?\s+(?:an?\s+|the\s+)?/i;
const TITLE_BOUNDARY = /\b(?:that|which|where|whose|using|use|with|without|so that|because)\b/i;
const GENERIC_PROMPTS = /^(?:get the|build|make|create|project|idea)$/i;
const ACRONYMS = new Map([
  ["ai", "AI"], ["ble", "BLE"], ["cad", "CAD"], ["esp32", "ESP32"], ["fdm", "FDM"],
  ["fpv", "FPV"], ["gnss", "GNSS"], ["gps", "GPS"], ["midi", "MIDI"], ["naca", "NACA"],
  ["oled", "OLED"], ["pc", "PC"], ["rc", "RC"], ["rgb", "RGB"], ["ros", "ROS"],
  ["tft", "TFT"], ["usb", "USB"], ["wi-fi", "Wi-Fi"], ["wifi", "Wi-Fi"],
]);

const TITLE_OVERRIDES = Object.freeze({
  "build_make-me-a-display-that-shows-environmental-sensor-i-want_otHFfSSv-FYHBw": "Touchscreen Temperature and Humidity Monitor",
  "get-the-362211ca": "Build Idea Needs More Detail",
  "i-m-working-on-a-non-tech-pen-testing-init-1a849d90": "Project Review Dashboard",
  "i-want-to-build-a-ultrasonic-sensor-that-d-12492162": "Wall-Mounted Presence Monitor",
  "test-project-desk-weather-dial-use-an-esp3-fc058adf": "Desk Weather Dial",
  "build-a-circuit-only-indoor-comfort-coach--dfb2aeb6": "Indoor Comfort Coach",
  "i-want-a-kitchen-device-with-1-86-inch-rou-2663cfc3": "Kitchen Touchscreen Companion",
  "i-have-esp32-c3-mini-and-0-96-inch-oled-it-bea35c59": "Retro PC Status Monitor",
  "i-want-to-build-an-desk-companion-with-esp-66be5d5a": "Tiny ESP32-C3 Desk Companion",
  "i-wanna-build-a-e-ink-keychain-a3e858cb": "Tiny OLED Status Keychain",
  "i-want-to-make-a-small-delivery-robot-with-4e869ed8": "ROS-Ready Delivery Robot",
  "i-want-to-make-a-midi-control-pad-to-manag-313765ec": "MIDI Control Pad",
  "macintosh-mini-f347cfc8": "Retro Macintosh Mini",
  "create-me-a-tiny-macintosh-1f2c149d": "Mini Macintosh",
  "espmarauder-03d44489": "ESP Marauder-Style Wi-Fi Handheld",
  "want-to-build-espmaradurer-b77de90d": "Human-Presence Radar Notifier",
  "make-a-santa-door-greeter-with-merry-653025fb": "Santa Door Greeter",
  "build-me-something-for-christmas-that-gree-dba4031e": "Santa Door Greeter",
  "create-a-desk-pet-that-can-detect-when-im--323d9952": "Desk Pet Presence Detector",
  "something-for-thanksgiving-to-show-my-fami-451ff355": "Thanksgiving Glow Keepsake",
  "make-a-device-that-can-track-my-crypto-96015cf4": "Crypto Price Tracker",
  "make-a-rubik-s-cube-inspired-esp32-display-f9ea946b": "Rubik's Cube-Inspired ESP32 Display",
  "i-want-to-build-a-mini-mac-926c066e": "Mini Mac-Style ESP32 Desktop",
  "make-a-lime-following-two-wheel-esp32-rove-787bbbf1": "Two-Wheel ESP32 Rover",
  "i-need-to-track-the-usage-of-every-data-po-66590c00": "Server-Rack Thermal Camera Monitor",
  "make-a-tiny-mac-mini-style-esp32-desktop-88af8743": "Mac Mini-Style ESP32 Desktop",
  "make-a-lime-following-two-wheel-esp32-rove-f9f18a96": "Lime-Following ESP32 Rover",
  "lime-follower-robot-57cb26fe": "Lime-Following ESP32 Rover",
  "drone-fpv-4032b7dc": "ESP32 FPV Camera Node",
  "i-want-yto-build-a-electron-microscope-90850443": "Electron Microscope",
  "la-sborra-di-cane-a0646378": "ESP32 Text Display",
  "i-need-a-something-like-a-physical-device--1fc9e20c": "Portable AI Camera Companion",
  "a-small-robot-that-speaks-the-day-time-tem-eea0d3b5": "Weather and Distance Desk Companion",
  "a-holographic-claude-pet-on-my-desk-f1029f15": "Claude Desk Pet Display",
  "spice-dispenser-7daf85c4": "Push-Button Spice Dispenser",
  "make-a-cute-moving-panda-robot-car-9b2954e4": "Panda Robot Car",
  "mini-pc-with-linux-using-a-esp32-s3-or-ras-296858d2": "ESP32 Desk Controller",
  "something-that-i-can-attach-my-byd-atto-3--c7f6db8a": "BYD Charging Cable Rest",
  "tiny-mac-mini-ebf059a1": "Mac Mini-Style Desktop Case",
  "make-a-personalized-desktop-buddy-clock-64f12674": "Desktop Buddy Clock",
  "personalised-desktop-buddy-with-pen-holder-edb1134f": "Desktop Buddy Clock",
  "make-something-with-1-8inch-tft-st7735-and-0be0d387": "ESP32 Mini Status Dashboard",
  "make-something-with-1-8inch-tft-and-esp32-d22dad2a": "ESP32 Touch Dashboard",
  "i-wanna-build-a-small-desk-companion-that--a1bec523": "Macintosh-Style Pomodoro Desk Companion",
  "quiero-un-mini-monitor-donde-me-pueda-indi-76d12cfa": "Monitor ESP32 de Hora y Mercados",
  "e-ink-display-to-give-me-a-breakdown-on-br-9dbff76b": "ESP32 News and Transit Dashboard",
  "i-want-a-3inch-display-personalized-deksto-ec2cfe32": "Personalized Desktop Buddy",
  "create-chinka-a-elephant-shaped-deskpet-th-d821c622": "Chinka Elephant Weather Desk Pet",
  "design-a-mini-cute-desk-robot-enclosure-fo-6c34e29e": "Mini Desk Robot",
  "design-a-mini-cute-desk-robot-enclosure-fo-5900de51": "Mini Desk Robot Enclosure",
  "design-a-smart-desktop-display-integrated--632bb487": "Moving WALL-E Desktop Companion",
  "create-it-in-a-cute-panda-that-can-move-58ea2f09": "Moving Panda Robot",
  "make-a-porsche-997-911-double-cup-38d363a5": "Porsche 997 Twin Cup Holder Concept",
  "make-https-www-etsy-com-listing-1836011597-85642356": "Porsche 997 Double Cup Holder",
  "smart-toothbrush-with-a-timer-that-rings-e-9603cb06": "Smart Toothbrush Timer",
  "a-cool-communication-tool-with-my-partner--f2934c44": "Partner Message and Day Counter",
  "a-smart-planter-that-doesn-t-need-a-water--1e27043e": "Smart Plant Monitor",
  "i-want-to-build-a-alarm-clock-e2544e9b": "Touchscreen Alarm Clock",
  "i-wanna-build-a-cat-collar-tracker-for-our-0a6363b9": "Cat Collar Location Tracker",
  "build-me-a-naca-0009-cad-object-to-simulat-1b90f7db": "NACA 0009 Airfoil Model",
  "i-want-to-build-a-programmable-move-up-and-85fecec3": "Standing Desk Preset Controller",
  "a-physical-alarm-d5d0194a": "Touch-Activated ESP32 Alarm",
  "build-an-faa-approved-a350-that-i-can-sell-18153978": "Commercial Aircraft Certification Request",
  "build-a-compact-desktop-eye-health-assista-ce2bf0ac": "20-20-20 OLED Eye-Strain Timer",
  "build-a-compact-desktop-eye-health-assista-2b2ede35": "20-20-20 Touchscreen Eye-Strain Timer",
  "i-want-to-build-a-cute-plant-monitoring-pe-528e7a79": "Tamagotchi-Style Plant Pet",
  "i-want-to-build-a-plant-watering-system-b91fad86": "Soil-Moisture Plant Monitor",
  "a-smarter-robot-vacuum-cleaner-27aa0beb": "Robot Vacuum Navigation Prototype",
  "build-a-compact-ergonomic-desk-device-call-daca0108": "Posture and Distance Desk Monitor",
  "make-a-cat-friendly-expressive-floor-robot-f7025569": "Cat-Friendly Floor Robot",
  "a-robot-vaccuum-cleaner-with-face-that-can-d1ea57e4": "Cat-Friendly Expressive Floor Robot",
  "i-want-to-build-a-mac-mini-from-scratch-28bcf0ae": "Mac Mini-Inspired Desktop Companion",
  "i-want-a-couple-companion-to-send-messages-7d797d39": "Wi-Fi Animated Message Board",
  "design-a-compact-desktop-under-shelf-trash-d8b9650f": "Desktop Trash Sorting Prototype",
  "digital-vinyl-player-4f45f370": "Digital Vinyl Player",
  "i-want-to-build-a-smaller-sticker-version--61d4eda2": "Sticker-Size Tracking Tag",
  "3-axis-robot-arm-abcaee4f": "Future Robot Arm Controller",
  "drone-e2e768c9": "Drone Electronics Concept",
  "drone-d8365037": "ESP32 Drone Control Prototype",
  "lets-build-json-and-csv-data-input-system--d2e391e9": "Data Table Viewer",
  "make-a-quiet-door-chime-65f2fa7e": "Quiet Visual Door Chime",
  "build-me-a-smart-light-door-sensor-that-tu-23b5b889": "ESP32 Room-Entry Detector",
  "i-want-to-make-a-really-cute-desktop-pet-t-213fcb07": "Cute Touchscreen Desktop Pet",
  "create-me-a-cute-desk-pet-dragon-that-trac-055033a5": "Token-Tracking Dragon Desk Pet",
  "create-a-fun-desk-toy-that-can-count-how-m-ba1c9db0": "OLED Desk Presence Timer",
  "create-me-a-hardware-product-that-can-sens-a60a68c7": "Desk Presence Sensor",
  "i-want-to-show-on-a-display-when-my-plant--51e17521": "ESP32 Soil-Dry Indicator",
  "i-want-to-make-a-door-sensor-that-turns-on-b2c67525": "Radar Room-Entry Light",
  "a-small-desk-timer-with-a-2-8-inch-display-bf3edd6d": "OLED Desk Timer",
  "i-want-to-build-a-toy-car-275c6b87": "Toy Car Touch Display",
  "i-want-to-build-a-rubiks-cube-where-all-th-e222fcb9": "Rubik's Cube-Style ESP32 Display",
});

const SUMMARY_OVERRIDES = Object.freeze({
  "get-the-362211ca": "This saved idea did not include enough detail to select task-specific parts. Add the intended function to turn it into a complete build.",
  "build_build-a-quiet-visual-door-open-notifier-using-a-magnetic_XHIYhukFprNH5A": "Know when the door changes state without having to keep watch. A door-side sensor-and-camera node detects the change, then sends the update wirelessly to a separate OLED status display.",
});

const BEHAVIOR_DESCRIPTION_OVERRIDES = new Set([
  "test-project-desk-weather-dial-use-an-esp3-fc058adf",
  "build-a-circuit-only-indoor-comfort-coach--dfb2aeb6",
  "make-a-santa-door-greeter-with-merry-653025fb",
  "make-a-lime-following-two-wheel-esp32-rove-787bbbf1",
  "i-want-to-build-a-cute-plant-monitoring-pe-528e7a79",
]);

/**
 * Repairs known generator fallback copy at the presentation boundary. The
 * original stored record remains untouched; only generic headings are
 * replaced, and the stable build id is used because public gallery payloads
 * intentionally omit the maker's private prompt.
 */
export function projectDisplayIdentity(build) {
  const storedTitle = cleanSentence(build?.title);
  const storedSummary = cleanSentence(build?.summary);
  const fallbackTitle = titleFromPrompt(build?.idea) || titleFromBuildId(build?.id);
  const titleCandidate = TITLE_OVERRIDES[build?.id] || (GENERIC_TITLES.test(storedTitle)
    ? fallbackTitle || (storedTitle.toLowerCase().includes("starter") ? "Project Needs More Detail" : "Project Overview")
    : storedTitle || fallbackTitle || "Project Overview");
  const title = customerProjectTitle(normalizeProjectTitle(titleCandidate));
  const useBehavior = BEHAVIOR_DESCRIPTION_OVERRIDES.has(build?.id)
    || GENERIC_SUMMARIES.test(storedSummary)
    || /(?:…|\.\.\.)$/.test(storedSummary);
  const summaryCandidate = SUMMARY_OVERRIDES[build?.id] || (useBehavior
    ? summaryFromBehavior(build?.behavior, title)
    : storedSummary || summaryFromBehavior(build?.behavior, title));
  const summary = customerProjectSummary(summaryCandidate, title);

  return { title, summary };
}

/**
 * Produces the customer-facing build record consumed by every gallery and
 * project surface. Keeping this at the collection boundary prevents a card,
 * modal, sidebar, or workspace from accidentally falling back to raw
 * generator copy while preserving the original record for the audit ledger.
 */
export function withProjectDisplayIdentity(build) {
  return {
    ...build,
    ...projectDisplayIdentity(build),
  };
}

export function hasGenericProjectHeader(build) {
  return GENERIC_TITLES.test(cleanSentence(build?.title)) || GENERIC_SUMMARIES.test(cleanSentence(build?.summary));
}

export function hasInadequateProjectCopy(build) {
  const identity = projectDisplayIdentity(build);
  return !identity.title
    || !identity.summary
    || GENERIC_TITLES.test(identity.title)
    || GENERIC_SUMMARIES.test(identity.summary)
    || /(?:…|\.\.\.)$/.test(identity.summary)
    || /\b(?:with (?:dual|merry|moving|tiny|[0-9]+|silent|status|small|animated|rotary)|on|for a future)$/i.test(identity.title)
    || IMPLEMENTATION_TITLE_TERMS.test(identity.title)
    || ROBOTIC_SUMMARY_LEAD.test(identity.summary)
    || INCOMPLETE_SUMMARY_END.test(identity.summary)
    || identity.summary.split(/\s+/).length < 10;
}

function customerProjectTitle(value) {
  const title = cleanSentence(value)
    .replace(new RegExp(IMPLEMENTATION_TITLE_TERMS.source, "gi"), "")
    .replace(/\s+([:–—-])/g, "$1")
    .replace(/([:–—-])\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^Desk Controller$/i, "Desktop Control Panel")
    .replace(/^Text Display$/i, "Custom Text Display")
    .replace(/^Touch Dashboard$/i, "Touchscreen Status Dashboard")
    .replace(/^(?:Tiny )?Status Gadget$/i, "Pocket Status Display");
  return title || "Project Overview";
}

function customerProjectSummary(value, title) {
  const summary = cleanSentence(value);
  if (!summary || !ROBOTIC_SUMMARY_LEAD.test(summary)) {
    return summary;
  }

  // Classify the project from its customer-facing title. Technical behavior
  // copy often contains incidental words such as "car-body" or "presence"
  // that describe construction, not the project's actual purpose.
  const context = title.toLowerCase();
  const lead = /\b(?:door|doorway|entry|greeter|chime)\b/.test(context)
    ? "Know when someone arrives or a door changes state, without having to keep watch."
    : /\b(?:plant|soil|watering)\b/.test(context)
      ? "Catch changing plant conditions before they become a problem."
      : /\b(?:air|climate|weather|temperature|humidity|co2|comfort)\b/.test(context)
        ? "See how your space feels at a glance and know when something needs attention."
        : /\b(?:message|valentine|partner|communication)\b/.test(context)
          ? "Share a small moment with someone you care about, even when you are apart."
          : /\b(?:standing desk|desk height|height presets?)\b/.test(context)
            ? "Explore a simpler way to choose your favorite desk heights from one dedicated control panel."
            : /\b(?:phone stand|phone holder)\b/.test(context)
              ? "Keep your phone upright, comfortable to view, and easy to reach while you work."
              : /\b(?:cup holder|cupholder)\b/.test(context)
                ? "Keep drinks secure and easy to reach without cluttering the space around you."
                : /\b(?:trash|sorter|sorting)\b/.test(context)
                  ? "Sort everyday waste with less guesswork and keep the setup tidy."
                  : /\b(?:spice|dispenser)\b/.test(context)
                    ? "Make repeatable portions easier with one simple press."
                    : /\b(?:game|handheld)\b/.test(context)
                      ? "Carry a small interactive demo you can pick up and play with."
                      : /\b(?:tag|tracker|tracking)\b/.test(context)
                        ? "Keep track of the things that matter without adding a bulky device."
              : /\bpresence\b/.test(context)
                ? "See when your desk or room is occupied without relying on a camera."
                : /\b(?:clock|timer|alarm|pomodoro)\b/.test(context)
            ? "Keep time and everyday reminders close at hand, without reaching for your phone."
            : /\b(?:pet|companion|buddy)\b/.test(context)
              ? "Bring a little personality to your desk with something that responds and changes."
              : /\b(?:robot|rover|car|vehicle)\b/.test(context)
                ? "Turn a playful moving idea into something you can build, test, and keep improving."
                : /\b(?:light|glow|lamp|rocket|prop)\b/.test(context)
                  ? "Add a responsive bit of light and personality to your space."
                  : /\b(?:display|dashboard|monitor|status|viewer|panel|desktop|mac|vinyl)\b/.test(context)
                    ? "Keep the information you care about easy to spot at a glance."
                    : "";
  if (!lead) return summary;

  const firstSentence = summary.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || summary;
  const remainder = summary.slice(firstSentence.length).trim();
  let detail = firstSentence
    .replace(/^(?:A|An|The)\s+.+?\s+(uses|shows|measures|detects|tracks|receives|runs|reads|plays|gives|keeps|can)\b/i, (_, verb) => `It ${verb.toLowerCase()}`)
    .replace(/^(?:A|An|The)\s+.+?\s+using\b/i, "It uses")
    .replace(/^(?:A|An|The)\s+.+?\s+built around\b/i, "It is built around")
    .replace(/^(?:A|An|The)\s+.+?\s+that\b/i, "It")
    .trim();
  if (/\b(?:lets you know|alerts you).*(?:someone arrives|door)\b/i.test(detail) && /\b(?:door|chime|greeter)\b/i.test(context)) {
    detail = remainder;
  }
  const limitation = /\b(?:catalog does not|not available|cannot|can only|does not include)\b/i.test(remainder) ? remainder : "";
  const combined = `${lead} ${detail} ${limitation}`.replace(/\s+/g, " ").trim();
  if (combined.length <= 380) return combined;
  const concise = `${lead} ${detail}`.replace(/\s+/g, " ").trim();
  if (concise.length <= 380) return concise;
  const sentenceBoundary = concise.slice(0, 380).match(/^.*[.!?](?=\s|$)/)?.[0];
  return sentenceBoundary || `${concise.slice(0, 378).replace(/\s+\S*$/, "")}.`;
}

function titleFromBuildId(value) {
  const prompt = cleanSentence(value)
    .replace(/-[a-f0-9]{8}$/i, "")
    .replace(/[_-]+/g, " ");
  return titleFromPrompt(prompt);
}

function titleFromPrompt(value) {
  let prompt = cleanSentence(value)
    .replace(/[’']/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!prompt) return "";
  prompt = prompt.replace(PROMPT_PREFIX, "").trim();
  const boundary = prompt.search(TITLE_BOUNDARY);
  if (boundary > 0) prompt = prompt.slice(0, boundary).trim();
  prompt = prompt.replace(/^(?:an?|the)\s+/i, "").replace(/[.,;:!?]+$/g, "").trim();
  if (!prompt || GENERIC_PROMPTS.test(prompt) || prompt.split(/\s+/).length > 9) return "";
  return prompt.split(/\s+/).map(titleWord).join(" ");
}

function summaryFromBehavior(value, title) {
  const behavior = cleanSentence(value);
  if (!behavior) return `Open ${title} to review its matched parts and current project details.`;

  const noPlan = behavior.match(/^No hardware plan can be made.+?for (?:an?|the) (.+?)(?:\. |\.$)/i);
  if (noPlan?.[1]) {
    const subject = noPlan[1].replace(/\s+/g, " ").trim();
    return `This ${subject} needs parts that are not available in Makeable's current catalog yet.`;
  }
  return behavior;
}

function titleWord(word, index) {
  const normalized = word.toLowerCase();
  if (ACRONYMS.has(normalized)) return ACRONYMS.get(normalized);
  if (index > 0 && /^(?:a|an|and|at|for|in|of|on|the|to)$/.test(normalized)) return normalized;
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function normalizeProjectTitle(value) {
  return cleanSentence(value)
    .replace(/\bEsp32[- ]?c3\b/gi, "ESP32-C3")
    .replace(/\bEsp32[- ]?c6\b/gi, "ESP32-C6")
    .replace(/\bEsp32[- ]?s3\b/gi, "ESP32-S3")
    .replace(/\bEsp32\b/gi, "ESP32")
    .replace(/\bOled\b/gi, "OLED")
    .replace(/\bTft\b/gi, "TFT")
    .replace(/\bPc\b/gi, "PC")
    .replace(/\bBle\b/gi, "BLE")
    .replace(/\bByd\b/gi, "BYD")
    .replace(/\bGps\b/gi, "GPS")
    .replace(/\bFpv\b/gi, "FPV")
    .replace(/\bRc\b/gi, "RC")
    .replace(/\bJson\b/gi, "JSON")
    .replace(/\bCsv\b/gi, "CSV")
    .replace(/\bNaca\b/gi, "NACA")
    .replace(/\bCad\b/gi, "CAD")
    .replace(/\bRos\b/gi, "ROS")
    .replace(/\bMidi\b/gi, "MIDI")
    .replace(/\bAi\b/gi, "AI")
    .replace(/\bWi[- ]?fi\b/gi, "Wi-Fi")
    .replace(/\bWall-e\b/gi, "WALL-E")
    .replace(/\bCo2\b/gi, "CO2")
    .replace(/\bRubik S Cube\b/gi, "Rubik's Cube");
}

function cleanSentence(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").replace(/\s*,\s*\./g, ".").trim()
    : "";
}
