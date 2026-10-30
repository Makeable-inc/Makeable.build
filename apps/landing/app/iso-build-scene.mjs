// Animated isometric drawing for the landing page: a typed idea flows into four parts,
// which feed a finished desk device. Ink lines, three flat tones, one accent (pink).
// Everything is a pure function of time t, so any frame can be rendered on demand.
// loop: 24 s (two prompts of 12 s, pulses 0.5 s, cursor 1 s)

const LOOP = 24;
const NS = "http://www.w3.org/2000/svg";
const U = [0.866, 0.5];
const V = [0.866, -0.5];

export function P(c, a, b, z) { return [c[0] + a * U[0] + b * V[0], c[1] + a * U[1] + b * V[1] - (z || 0)]; }
export function pts(a) { return a.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "); }
export function el(tag, at, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in at) e.setAttribute(k, at[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const frac = (x) => x - Math.floor(x);
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const wrapT = (t) => ((t % LOOP) + LOOP) % LOOP;
function since(tg, t0) { const d = (((tg - t0) % LOOP) + LOOP) % LOOP; return d > LOOP - 3 ? d - LOOP : d; }

// Box: floor centre c, half sizes ha (along u) and hb (along v), base z, height H, tone prefix (m, p, d)
export function box(g, c, ha, hb, z, H, tone) {
  const L = P(c, -ha, -hb), F = P(c, ha, -hb), R = P(c, ha, hb), B = P(c, -ha, hb);
  const up = (p, h) => [p[0], p[1] - h];
  el("polygon", { points: pts([up(L, z), up(F, z), up(F, z + H), up(L, z + H)]), class: tone + "l" }, g);
  el("polygon", { points: pts([up(F, z), up(R, z), up(R, z + H), up(F, z + H)]), class: tone + "r" }, g);
  return el("polygon", { points: pts([up(L, z + H), up(B, z + H), up(R, z + H), up(F, z + H)]), class: tone + "t" }, g);
}
export function topQuad(c, a0, a1, b0, b1, z) { return pts([P(c, a0, b0, z), P(c, a0, b1, z), P(c, a1, b1, z), P(c, a1, b0, z)]); }
// Text lying on a top face, reading up-right
export function floorText(g, c, a, b, z, txt, cls) {
  const o = P(c, a, b, z);
  const t = el("text", { transform: `matrix(.866,-.5,.866,.5,${o[0].toFixed(1)},${o[1].toFixed(1)})`, class: cls || "floortxt" }, g);
  t.textContent = txt;
  return t;
}

const PROMPTS = [["a desk pet that grows", "every time I code"], ["a plant pot that tells", "me when it's thirsty"]];

export function mountIsoBuildScene(host, { dark = false, seed = 7 } = {}) {
  const svg = el("svg", {
    class: "mk-iso" + (dark ? " mk-iso-dark" : ""),
    role: "img",
    "aria-label": "Drawing: a typed idea flows into four electronic parts, which feed a finished desk device whose screen fills up.",
  });
  host.appendChild(svg);
  const g = el("g", {}, svg);
  const Cp = [0, 0], Ci = P(Cp, 150, -300), Cd = P(Cp, 330, 60);

  // parts platform (back, drawn first)
  box(g, Cp, 165, 165, -16, 16, "p");
  [[-75, 75], [-75, -75], [75, 75], [75, -75]].forEach((cell) => {
    el("polygon", { points: topQuad(P(Cp, cell[0], cell[1]), -64, 64, -64, 64, 0), class: "pad" }, g);
  });
  const MOD = [ // back, left, right, front
    { name: 'OLED 0.96"', cell: [-78, 78], base: [52, 40, 7], ins: [40, 30, 9] },
    { name: "DHT22", cell: [-78, -78], base: [40, 40, 6], ins: [27, 24, 40] },
    { name: "ESP32-S3", cell: [78, 78], base: [58, 36, 7], ins: [26, 22, 11] },
    { name: "LIPO 1000", cell: [78, -78], base: [54, 44, 14], ins: [16, 34, 4] },
  ];
  MOD.forEach((m) => { m.c = P(Cp, m.cell[0], m.cell[1]); });
  // cable endpoints: back object's visible face -> front object's hidden face, low height
  const CH = 3;
  const CAB = {
    BL: [P(MOD[0].c, 0, -MOD[0].base[1], CH), P(MOD[1].c, 0, MOD[1].base[1], CH)],
    BR: [P(MOD[0].c, MOD[0].base[0], 0, CH), P(MOD[2].c, -MOD[2].base[0], 0, CH)],
    LF: [P(MOD[1].c, MOD[1].base[0], 0, CH), P(MOD[3].c, -MOD[3].base[0], 0, CH)],
    RF: [P(MOD[2].c, 0, -MOD[2].base[1], CH), P(MOD[3].c, 0, MOD[3].base[1], CH)],
  };
  const POOL = {};
  function cable(k) {
    el("path", { d: "M" + pts([CAB[k][0]]) + " L" + pts([CAB[k][1]]), class: "cable" }, g);
    POOL[k] = [];
    for (let i = 0; i < 6; i++) POOL[k].push(el("rect", { width: 8, height: 5, rx: 2, class: "pk", opacity: 0 }, g));
  }
  function drawMod(m) {
    floorText(g, m.c, m.base[0] + 14, -m.base[1] - 2, 0, m.name);
    box(g, m.c, m.base[0], m.base[1], 0, m.base[2], "m");
    const z = m.base[2];
    box(g, m.c, m.ins[0], m.ins[1], z, m.ins[2], "m");
    const zt = z + m.ins[2];
    m.chip = el("polygon", { points: topQuad(m.c, -m.ins[0], m.ins[0], -m.ins[1], m.ins[1], zt), class: "acc ghost", "fill-opacity": 0.14 }, g);
    const gr = el("g", { class: "grid" }, g);
    for (let i = 1; i < 4; i++) {
      const fa = -m.ins[0] + (2 * m.ins[0] * i) / 4, fb = -m.ins[1] + (2 * m.ins[1] * i) / 4;
      const a1 = P(m.c, fa, -m.ins[1], zt), a2 = P(m.c, fa, m.ins[1], zt), b1 = P(m.c, -m.ins[0], fb, zt), b2 = P(m.c, m.ins[0], fb, zt);
      el("line", { x1: a1[0], y1: a1[1], x2: a2[0], y2: a2[1] }, gr);
      el("line", { x1: b1[0], y1: b1[1], x2: b2[0], y2: b2[1] }, gr);
    }
    el("polygon", { points: topQuad(m.c, -m.ins[0], m.ins[0], -m.ins[1], m.ins[1], zt), fill: "none" }, g);
    // two LEDs on the base's left face
    m.leds = [0, 1].map((j) => {
      const a = m.base[0] - 12 - j * 9, zz = Math.max(1.5, m.base[2] / 2 - 1.5);
      return el("polygon", { points: pts([P(m.c, a, -m.base[1], zz), P(m.c, a + 5, -m.base[1], zz), P(m.c, a + 5, -m.base[1], zz + 3), P(m.c, a, -m.base[1], zz + 3)]), class: "acc ghost", opacity: 0.3 }, g);
    });
  }
  drawMod(MOD[0]); cable("BL"); cable("BR"); drawMod(MOD[1]); drawMod(MOD[2]); cable("LF"); cable("RF"); drawMod(MOD[3]);

  // streams between platforms (drawn before the tablet and the device so their ends hide)
  const tabH = 6, tab = { ha: 58, hb: 76 }, dev = { ha: 50, hb: 54, H: 92 };
  const s1a = P(Ci, 0, tab.hb, 3), s1b = P(MOD[3].c, 0, -MOD[3].base[1], 7);
  const s2a = P(MOD[2].c, MOD[2].base[0], 0, 4), s2b = P(Cd, -dev.ha, 0, 26);
  const curve = (a, b, lift) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift]; return "M" + pts([a]) + " Q" + pts([m]) + " " + pts([b]); };
  const path1 = el("path", { d: curve(s1a, s1b, 70), class: "stream" }, g);
  const path2 = el("path", { d: curve(s2a, s2b, 60), class: "stream" }, g);
  const pulses1 = [], pulses2 = [];
  for (let i = 0; i < 8; i++) { pulses1.push(el("circle", { r: 3.4, class: "pulse", opacity: 0 }, g)); pulses2.push(el("circle", { r: 3.4, class: "pulse", opacity: 0 }, g)); }

  // idea platform with the prompt tablet
  box(g, Ci, 92, 100, -16, 16, "p");
  box(g, Ci, tab.ha, tab.hb, 0, tabH, "m");
  el("polygon", { points: topQuad(Ci, -tab.ha + 8, tab.ha - 8, -tab.hb + 8, tab.hb - 8, tabH), class: "pt" }, g);
  const line1 = floorText(g, Ci, -14, -tab.hb + 16, tabH, "", "typed");
  const line2 = floorText(g, Ci, 2, -tab.hb + 16, tabH, "", "typed");
  const cursor = el("polygon", { points: "", class: "acc ghost" }, g);
  const keyG = el("g", {}, g);
  function drawKey(press) { // send key near the front corner of the tablet
    keyG.replaceChildren();
    const kc = P(Ci, 34, 54);
    box(keyG, kc, 9, 9, tabH, 4 - press * 3, "m");
    el("polygon", { points: topQuad(kc, -9, 9, -9, 9, tabH + 4 - press * 3), class: "acc", "fill-opacity": 0.35 + 0.65 * press }, keyG);
  }
  floorText(g, Ci, 72, -80, 0, "PROMPT");

  // device platform
  box(g, Cd, 96, 96, -16, 16, "p");
  el("polygon", { points: topQuad(Cd, -76, 76, -76, 76, 0), class: "pad" }, g);
  box(g, Cd, dev.ha, dev.hb, 0, dev.H, "d");
  for (let v = 0; v < 6; v++) { // vents on top and right face
    const t1 = P(Cd, -30 + v * 6, 20, dev.H), t2 = P(Cd, -30 + v * 6, 44, dev.H);
    el("line", { x1: t1[0], y1: t1[1], x2: t2[0], y2: t2[1], class: "vent" }, g);
    const r1 = P(Cd, dev.ha, 14 + v * 6, 52), r2 = P(Cd, dev.ha, 14 + v * 6, 76);
    el("line", { x1: r1[0], y1: r1[1], x2: r2[0], y2: r2[1], class: "vent" }, g);
  }
  const leftRect = (a0, a1, z0, z1) => pts([P(Cd, a0, -dev.hb, z0), P(Cd, a1, -dev.hb, z0), P(Cd, a1, -dev.hb, z1), P(Cd, a0, -dev.hb, z1)]);
  el("polygon", { points: leftRect(-42, 42, 18, 80), class: "dt" }, g);
  el("polygon", { points: leftRect(-35, 35, 25, 73), class: "scr" }, g);
  const level = el("polygon", { points: "", class: "acc ghost" }, g);
  const ticks = [];
  for (let k = 0; k < 5; k++) ticks.push(el("polygon", { points: "", class: "acc ghost", opacity: 0 }, g));
  el("polygon", { points: leftRect(-35, 35, 25, 73), fill: "none" }, g);
  const devLed = el("polygon", { points: leftRect(26, 33, 8, 11), class: "acc ghost" }, g);
  el("polygon", { points: leftRect(-36, -12, 7, 12), class: "dl" }, g);

  // labels with elbow leaders
  function label(anchor, dx, dy, txt) {
    const e = [anchor[0] + dx, anchor[1] + dy], end = [e[0] + (dx < 0 ? -16 : 16), e[1]];
    el("path", { d: "M" + pts([anchor]) + " L" + pts([e]) + " L" + pts([end]), class: "leader" }, g);
    const t = el("text", { x: end[0] + (dx < 0 ? -6 : 6), y: end[1] + 3.5, "text-anchor": dx < 0 ? "end" : "start", class: "lbl" }, g);
    t.textContent = txt;
  }
  label(P(Ci, -92, -60, -16), -26, 26, "01 DESCRIBE");
  label(P(Cp, -150, 140, 0), -30, -34, "02 VERIFIED PARTS");
  label(P(Cd, 50, 54, dev.H), 34, -30, "03 WIRED + BUILT");

  const bb = g.getBBox(), pad = 14;
  svg.setAttribute("viewBox", [bb.x - pad, bb.y - pad, bb.width + pad * 2, bb.height + pad * 2].map((n) => n.toFixed(0)).join(" "));

  // seeded schedule: parts send bursts to the ESP32, some relayed through a neighbour
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const ROUTES = [
    [["BL", false, 1, 0], ["BR", true, 0, 2]], // sensor via display
    [["LF", true, 1, 3], ["RF", false, 3, 2]], // sensor via battery
    [["RF", false, 3, 2]],                     // battery
    [["RF", false, 3, 2]],
    [["BR", false, 2, 0]],                     // ESP32 updates the display
    [["BR", false, 2, 0], ["BL", true, 0, 1]],
  ];
  const HOP = 0.42, TRAVEL = 0.36, BURST = 3, GAP = 0.08, EVENTS = [], PINGS = [];
  for (let t = 0.1; t < LOOP - 1.8; t += 0.2 + rnd() * 0.5) {
    pick(ROUTES).forEach((h, i) => {
      const st = t + i * HOP;
      EVENTS.push({ cab: h[0], fwd: h[1], t: st });
      PINGS.push([h[2], st - 0.05]);
      PINGS.push([h[3], st + TRAVEL]);
    });
  }
  function activity(n, tg) {
    let a = 0;
    PINGS.forEach((p) => { if (p[0] !== n) return; const d = since(tg, p[1]); a = Math.max(a, clamp(Math.min(d / 0.06 + 1, (0.42 - d) / 0.14))); });
    return a;
  }
  function busyIntegral(n, tg) { let b = 0; PINGS.forEach((p) => { if (p[0] === n) b += clamp((tg - p[1] + 0.05) / 0.47) * 0.47; }); return b; }
  const BOOST = [0, 1, 2, 3].map((n) => { const e = busyIntegral(n, LOOP); return e ? Math.round(e * 2.2) / e : 0; });
  const phase = (n, tg) => (16 * tg) / LOOP + BOOST[n] * busyIntegral(n, tg);
  function devAct(tg) { // ESP32 arrivals reach the device one stream-length later
    let a = 0;
    PINGS.forEach((p) => { if (p[0] !== 2) return; const d = since(tg, p[1] + 1.0); a = Math.max(a, clamp(Math.min(d / 0.2 + 1, (1.8 - d) / 1.2))); });
    return a;
  }

  const len1 = path1.getTotalLength(), len2 = path2.getTotalLength();
  function pulses(list, path, len, t) {
    list.forEach((p, i) => {
      const k = frac((t - (i % 4) * 0.07 - (i >= 4 ? 0.5 : 0)) / 1.0), pt = path.getPointAtLength(k * len);
      p.setAttribute("cx", pt.x.toFixed(1));
      p.setAttribute("cy", pt.y.toFixed(1));
      p.setAttribute("opacity", Math.min(1, k * 12, (1 - k) * 12).toFixed(2));
    });
  }

  function render(t) {
    const tg = wrapT(t);
    // prompt typing
    const slot = Math.floor(tg / 12), tp = tg - slot * 12, lines = PROMPTS[slot];
    const total = lines[0].length + lines[1].length;
    const n = Math.floor(clamp((tp - 0.3) / 3.0) * total);
    const fade = clamp((11.6 - tp) / 0.8);
    line1.textContent = lines[0].slice(0, n);
    line2.textContent = lines[1].slice(0, Math.max(0, n - lines[0].length));
    line1.setAttribute("opacity", fade);
    line2.setAttribute("opacity", fade);
    const onL2 = n > lines[0].length, cn = onL2 ? n - lines[0].length : n;
    const ca = onL2 ? 2 : -14, cb = -tab.hb + 16 + cn * 5.75;
    cursor.setAttribute("points", topQuad(Ci, ca - 9, ca + 1, cb, cb + 4, tabH));
    cursor.setAttribute("opacity", frac(tg) < 0.5 ? 1 : 0);
    drawKey(clamp(1 - Math.abs(tp - 3.6) / 0.18));

    pulses(pulses1, path1, len1, tg);
    pulses(pulses2, path2, len2, tg);

    // packets on cables
    const used = {};
    for (const c in POOL) used[c] = 0;
    EVENTS.forEach((e) => {
      const d0 = since(tg, e.t), cc = CAB[e.cab];
      for (let j = 0; j < BURST; j++) {
        const k = (d0 - j * GAP) / TRAVEL;
        if (k <= 0 || k >= 1 || used[e.cab] >= POOL[e.cab].length) continue;
        const p = POOL[e.cab][used[e.cab]++], kk = e.fwd ? k : 1 - k;
        p.setAttribute("x", (cc[0][0] + (cc[1][0] - cc[0][0]) * kk - 4).toFixed(1));
        p.setAttribute("y", (cc[0][1] + (cc[1][1] - cc[0][1]) * kk - 2.5).toFixed(1));
        p.setAttribute("opacity", Math.min(1, k * 10, (1 - k) * 10).toFixed(2));
      }
    });
    for (const c in POOL) for (let u = used[c]; u < POOL[c].length; u++) POOL[c][u].setAttribute("opacity", 0);

    // chips and LEDs
    MOD.forEach((m, idx) => {
      const a = activity(idx, tg), ph = phase(idx, tg);
      m.chip.setAttribute("fill-opacity", (0.14 + 0.86 * a).toFixed(2));
      m.leds.forEach((led, j) => { led.setAttribute("opacity", frac(ph * 3 + j * 0.37) < 0.5 ? 1 : (0.25 + 0.15 * a).toFixed(2)); });
    });

    // device screen: floor 40 %, ceiling 85 %
    const lv = 0.4 + 0.45 * devAct(tg), zTop = 25 + 48 * lv;
    level.setAttribute("points", leftRect(-35, 35, 25, zTop));
    ticks.forEach((tk, j) => {
      const a0 = -30 + j * 13, h = frac(tg * 0.5 + j * 0.29), z0 = zTop + 3 + h * 10;
      tk.setAttribute("points", leftRect(a0, a0 + 5, z0, z0 + 3));
      tk.setAttribute("opacity", z0 + 3 < 72 ? (0.9 * (1 - h)).toFixed(2) : 0);
    });
    devLed.setAttribute("opacity", frac(tg * 2) < 0.5 ? 1 : 0.3);
  }

  return { svg, render };
}

// Small wiring view for the walkthrough: an ESP32 board and a display on a grid, four wires.
export function mountIsoWiring(host) {
  const svg = el("svg", { class: "mk-iso", viewBox: "-210 -120 420 250", preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true" });
  host.appendChild(svg);
  const g = el("g", {}, svg), O = [0, 0];
  for (let k = -5; k <= 5; k++) {
    const a1 = P(O, k * 40, -200), a2 = P(O, k * 40, 200), b1 = P(O, -200, k * 40), b2 = P(O, 200, k * 40);
    el("line", { x1: a1[0], y1: a1[1], x2: a2[0], y2: a2[1], class: "floor" }, g);
    el("line", { x1: b1[0], y1: b1[1], x2: b2[0], y2: b2[1], class: "floor" }, g);
  }
  const cE = P(O, -10, -90), cD = P(O, 20, 95);
  // display (back) first, then wires, then the ESP32 board in front
  box(g, cD, 42, 46, 0, 6, "m");
  box(g, cD, 34, 38, 6, 3, "m");
  el("polygon", { points: topQuad(cD, -28, 28, -32, 32, 9), class: "scr" }, g);
  el("polygon", { points: topQuad(cD, -28, -8, -32, 10, 9), class: "acc ghost", opacity: 0.85 }, g);
  const pinsD = [-24, -12, 0, 12].map((b) => P(cD, -40, b, 7));
  const pinsE = [-18, -6, 6, 18].map((b) => P(cE, 30, b + 40, 9));
  const WIRES = [["#e5484d", 0.3], ["#1b1d24", 1.1], ["#ff2d73", 1.9], ["#1688ff", 2.7]];
  pinsE.forEach((s, i) => {
    const e = pinsD[i], m1 = [s[0] + 10, s[1] - 70], m2 = [e[0] - 30, e[1] - 70];
    el("path", { d: "M" + pts([s]) + " C" + pts([m1]) + " " + pts([m2]) + " " + pts([e]), class: "wire", stroke: WIRES[i][0], pathLength: 1, style: `--at:${WIRES[i][1]}s` }, g);
  });
  box(g, cE, 34, 62, 0, 7, "m");
  box(g, cE, 14, 16, 7, 6, "m");
  el("polygon", { points: topQuad(cE, -14, 14, -16, 16, 13), class: "acc ghost", "fill-opacity": 0.9 }, g);
  for (let i = -50; i <= 50; i += 10) { const hp = P(cE, 28, i, 7); el("rect", { x: hp[0] - 1.5, y: hp[1] - 4, width: 3, height: 4, class: "pin" }, g); }
  floorText(g, cE, 40, -60, 0, "ESP32-S3");
  floorText(g, cD, 50, -40, 0, 'LCD 1.3"');
  return svg;
}
