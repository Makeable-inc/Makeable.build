// Presentation only: never changes saved steps, connections, pin names or geometry.
export function compactStepNumbers(count, current) {
  if (count <= 4) return Array.from({ length: count }, (_, i) => i);
  const start = Math.max(0, Math.min(current - 1, count - 3));
  const indices = [...new Set([0, start, start + 1, start + 2, count - 1])].sort((a, b) => a - b);
  const result = [];
  for (const index of indices) {
    if (result.length && index - result.at(-1) > 1) result.push("gap");
    result.push(index);
  }
  return result;
}

export function friendlyPartName(part = {}) {
  const value = `${part.role || ""} ${part.category || ""} ${part.label || ""} ${part.name || ""}`;
  if (/microphone|inmp.?441|i2s.+mic|audio capture/i.test(value)) return "Microphone";
  if (/carrier|expansion|breakout base/i.test(value)) return "Expansion board";
  if (/controller|devkit|esp32|microcontroller|arduino/i.test(value)) return "Controller";
  if (/rotary|encoder|knob/i.test(value)) return "Control knob";
  if (/vibration/i.test(value)) return "Vibration motor";
  if (/servo/i.test(value)) return "Servo motor";
  if (/motor/i.test(value)) return "Motor";
  if (/display|oled|screen|lcd/i.test(value)) return "Display";
  if (/button/i.test(value)) return "Button";
  if (/temperature|humidity/i.test(value)) return "Climate sensor";
  if (/buzzer|speaker/i.test(value)) return "Sound module";
  return part.label || part.name || "Part";
}

export function wiringCopy(step, assembly = {}) {
  if (!step) return { title: "", instruction: "", safety: "" };
  const replacements = (assembly.parts || []).flatMap(part => [part.label, part.name, part.id].filter(Boolean).map(label => [label, friendlyPartName(part)]))
    .sort((a, b) => b[0].length - a[0].length);
  const simplify = value => replacements.reduce((text, [raw, friendly]) => text.split(raw).join(friendly), String(value || ""));
  let title = simplify(step.title).replace(/^Seat\s+/i, "Add ").replace(/the rotary knob/i, "the knob");
  let instruction = simplify(step.beginnerInstruction);
  const sourceCopy = `${step.title || ""} ${step.beginnerInstruction || ""}`;
  if (/microphone|inmp.?441|i2s.+mic|audio capture/i.test(sourceCopy)) {
    title = "Connect the microphone";
    instruction = "Match each labeled microphone pin to the exact destination shown on the expansion board.";
  }
  if (step.kind === "mount" && /controller/i.test(title)) {
    title = "Add the controller";
    // Original instruction remains available in Part details; orientation checks remain visible.
    instruction = "Line up both pin rows with the expansion board. Keep the USB port facing the direction shown, then press down gently.";
  }
  return { title, instruction, safety: simplify(step.safetyNote) };
}

export function wiringEndpointLabel(endpoint, assembly = {}) {
  if (!endpoint) return "";
  const part = (assembly.parts || []).find(part => part.id === endpoint.partId);
  if (!part) return endpoint.label || endpoint.nodeName || endpoint.partId || "";
  const name = friendlyPartName(part);
  const label = endpoint.label || endpoint.nodeName || "";
  const terminal = label.replace(part.label || "\0", "").replace(part.id, "").replace(/^[\s·:—-]+/, "");
  return terminal ? `${name} · ${terminal}` : name;
}
