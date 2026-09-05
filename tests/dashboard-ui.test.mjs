import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardHtmlPath = new URL("../dashboard/index.html", import.meta.url);
const dashboardScriptPath = new URL("../dashboard/app.js", import.meta.url);
const waitlistScriptPath = new URL("../dashboard/waitlist.js", import.meta.url);
const socialScriptPath = new URL("../dashboard/social.js", import.meta.url);
const socialChartScriptPath = new URL("../dashboard/social-chart.js", import.meta.url);
const accountTableScriptPath = new URL("../dashboard/social-account-table.js", import.meta.url);
const socialModelScriptPath = new URL("../dashboard/social-model.js", import.meta.url);
const socialMediaStylePath = new URL("../dashboard/social-media.css", import.meta.url);
const landingPagePath = new URL("../apps/landing/app/page.tsx", import.meta.url);

test("dashboard keeps private auth and separates contacts, builders, and projects", async () => {
  const [html, script, socialScript, waitlistScript] = await Promise.all([
    readFile(dashboardHtmlPath, "utf8"),
    readFile(dashboardScriptPath, "utf8"),
    readFile(socialScriptPath, "utf8"),
    readFile(waitlistScriptPath, "utf8"),
  ]);

  assert.match(html, /Contacts and builder activity/);
  assert.match(html, /Customer activity/);
  assert.match(html, /Builder accounts/);
  assert.match(html, /Content exposures/);
  assert.match(html, /First builder login/);
  assert.match(html, /Last activity/);
  assert.match(script, /fetch\("\/api\/dashboard\/session"/);
  assert.match(script, /fetch\("\/api\/dashboard"/);
  assert.match(waitlistScript, /point\.newBuilders/);
  assert.match(waitlistScript, /point\.projects/);
  assert.match(script, /setAttribute\("aria-pressed"/);
  assert.match(socialScript, /setAttribute\("aria-pressed"/);
  assert.match(script, /refreshSources: true/);
  assert.match(script, /socialDashboard\.refresh\(\)/);
  assert.match(html, /data-social-range="30" aria-pressed="true"/);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
  assert.doesNotMatch(script, /\/api\/admin\/waitlist/);
});

test("social UI names the exposure-to-website funnel and its sortable account measures", async () => {
  // Break caught: restoring the old clicks summary or omitting conversion ranking hides the funnel.
  const html = await readFile(dashboardHtmlPath, "utf8");

  assert.match(html, />Content exposures</);
  assert.match(html, />Website conversions</);
  assert.match(html, />Website visit rate</);
  assert.match(html, /<option value="websiteSessions">Website conversions<\/option>/);
  assert.match(html, /<option value="websiteVisitRate">Website visit rate<\/option>/);
  assert.match(html, />Platform link clicks<\/th>/);
  assert.doesNotMatch(html, />Site clicks</);
});

test("Facebook links target the live Page used by owner analytics", async () => {
  // Break caught: the obsolete profile identifier renders Facebook's unavailable-content page.
  const [socialScript, landingPage] = await Promise.all([
    readFile(socialScriptPath, "utf8"),
    readFile(landingPagePath, "utf8"),
  ]);

  for (const source of [socialScript, landingPage]) {
    assert.match(source, /https:\/\/www\.facebook\.com\/profile\.php\?id=61593473267038/);
    assert.doesNotMatch(source, /61593471075023/);
  }
});

test("account table formatting preserves unknown and connected-zero values", async () => {
  // Break caught: coercing unknown attribution to zero makes disconnected accounts look measured.
  const { formatOptionalNumber, formatSocialPercent } = await import(accountTableScriptPath);

  assert.equal(formatOptionalNumber(null), "—");
  assert.equal(formatOptionalNumber(undefined), "—");
  assert.equal(formatOptionalNumber(0), "0");
  assert.equal(formatOptionalNumber(1234), "1,234");
  assert.equal(formatSocialPercent(null), "—");
  assert.equal(formatSocialPercent(0), "0.0%");
  assert.equal(formatSocialPercent(0.000068243), "0.007%");
  assert.equal(formatSocialPercent(0.04388), "4.4%");
});

test("social chart rates exclude partial public engagement", async () => {
  // Break caught: dividing a public interaction snapshot by all exposure data invents a rate.
  const { buildSocialView } = await import(socialModelScriptPath);
  const shared = {
    platform: "instagram",
    publishedAt: "2026-08-20T00:00:00.000Z",
    impressions: 1000,
    engagements: 50,
    followersGained: 0,
    clicks: 0,
    attributionKey: "makeable_build",
  };
  const view = buildSocialView([
    { ...shared, id: "complete", account: "@makeable.build", engagementsComplete: true },
    { ...shared, id: "partial", account: "@makeable.zak", engagements: 15, engagementsComplete: false },
  ], { days: "all" });

  assert.equal(view.daily[0].engagementRate, 0.05);
});

test("social chart splits measured engagement runs at unknown days", async () => {
  // Break caught: filtering unknown days before drawing joins measurements across a gap.
  const { measuredEngagementRuns } = await import(socialChartScriptPath);
  const runs = measuredEngagementRuns([
    { date: "2026-08-20", engagementRate: 0.04 },
    { date: "2026-08-21", engagementRate: 0.05 },
    { date: "2026-08-22", engagementRate: null },
    { date: "2026-08-23", engagementRate: 0.07 },
    { date: "2026-08-24", engagementRate: 0.08 },
  ]);

  assert.deepEqual(runs.map((run) => run.map(({ index }) => index)), [[0, 1], [3, 4]]);
});

test("rendered social chart retains its description and names both axes", async () => {
  // Break caught: replaceChildren detached the described-by node and left numeric ticks unnamed.
  const { renderSocialChart } = await import(socialChartScriptPath);
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS(_namespace, name) {
      return new TestSvgNode(name);
    },
  };
  try {
    const chart = new TestSvgNode("svg");
    chart.setAttribute("aria-labelledby", "socialChartTitle socialChartDescription");
    renderSocialChart({
      chart,
      chartWrap: { clientWidth: 800, clientHeight: 286 },
      data: [
        { date: "2026-08-20", impressions: 1000, engagementRate: 0.04 },
        { date: "2026-08-21", impressions: 1200, engagementRate: null },
      ],
    });
    const descendants = allDescendants(chart);
    const description = descendants.find((node) =>
      node.name === "desc" && node.getAttribute("id") === "socialChartDescription");
    const leftAxis = descendants.find((node) => node.getAttribute("data-axis") === "left");
    const rightAxis = descendants.find((node) => node.getAttribute("data-axis") === "right");

    assert.equal(chart.getAttribute("aria-labelledby"), "socialChartTitle socialChartDescription");
    assert.ok(description);
    assert.match(description.textContent, /content exposures/i);
    assert.match(description.textContent, /engagement rate/i);
    assert.equal(leftAxis?.textContent, "Content exposures");
    assert.equal(rightAxis?.textContent, "Engagement rate");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("edited dashboard source modules stay below 500 lines", async () => {
  // Break caught: oversized entrypoints make dashboard behavior harder to review safely.
  const paths = [
    "app.js", "overview.js", "waitlist.js", "social.js", "social-chart.js",
    "social-account-table.js", "social-model.js", "styles.css", "dashboard-shell.css",
    "waitlist.css", "dashboard-responsive.css", "social.css", "social-media.css",
  ];
  const sources = await Promise.all(paths.map((path) =>
    readFile(new URL(`../dashboard/${path}`, import.meta.url), "utf8")));

  paths.forEach((path, index) => {
    const lines = sources[index].split("\n").length;
    assert.ok(lines < 500, `${path} has ${lines} lines`);
  });
});

test("dashboard component colors come from the documented token palette", async () => {
  // Break caught: shared Social buttons and tables inherited undeclared literal colors.
  const paths = [
    "styles.css", "dashboard-shell.css", "waitlist.css", "dashboard-responsive.css",
    "social.css", "social-media.css",
  ];
  const sources = await Promise.all(paths.map((path) =>
    readFile(new URL(`../dashboard/${path}`, import.meta.url), "utf8")));
  sources[0] = sources[0].replace(/^:root \{[\s\S]*?\n\}/, "");

  paths.forEach((path, index) => {
    assert.doesNotMatch(sources[index], /#[0-9a-f]{3,8}\b|rgba?\(/i, `${path} has an orphan color`);
    const openingBraces = sources[index].match(/\{/g)?.length || 0;
    const closingBraces = sources[index].match(/\}/g)?.length || 0;
    assert.equal(openingBraces, closingBraces, `${path} has unbalanced blocks`);
  });
});

test("media dialog frame contains portrait replaced media", async () => {
  // Break caught: a portrait video's automatic grid minimum enlarged the bounded 16:9 frame.
  const css = await readFile(socialMediaStylePath, "utf8");
  const frame = css.match(/\.media-dialog-frame\s*\{([^}]*)\}/)?.[1] || "";
  const media = css.match(/\.media-dialog-frame video,\s*\.media-dialog-frame img\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(frame, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(frame, /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(frame, /overflow:\s*hidden/);
  assert.match(media, /min-width:\s*0/);
  assert.match(media, /min-height:\s*0/);
  assert.match(media, /max-width:\s*100%/);
  assert.match(media, /max-height:\s*100%/);
  assert.match(media, /object-fit:\s*contain/);
});

test("media viewer opening locks page scrolling at the current offset", async () => {
  // Given: a page scrolled beneath a playable media dialog.
  const { createMediaViewer } = await import(socialScriptPath);
  assert.equal(typeof createMediaViewer, "function");
  const harness = mediaViewerHarness();
  const viewer = createMediaViewer(harness.els, harness.options);

  // When: the dialog opens.
  await viewer.open(mediaRecord());

  // Then: the page is fixed at its current offset without removing the scrollbar gap.
  assert.equal(harness.root.classList.contains("is-media-viewer-open"), true);
  assert.equal(harness.body.classList.contains("is-media-viewer-open"), true);
  assert.equal(harness.root.style.overflow, "hidden");
  assert.equal(harness.body.style.position, "fixed");
  assert.equal(harness.body.style.top, "-480px");
  assert.equal(harness.body.style.paddingRight, "26px");
  assert.deepEqual(harness.scrollCalls, []);
});

test("native dialog close restores page scroll ownership and prior styles", async () => {
  // Given: an open media viewer over a scrolled page.
  const { createMediaViewer } = await import(socialScriptPath);
  assert.equal(typeof createMediaViewer, "function");
  const harness = mediaViewerHarness();
  const viewer = createMediaViewer(harness.els, harness.options);
  await viewer.open(mediaRecord());

  // When: Escape/native cancel closes the dialog.
  harness.els.dialog.cancel();

  // Then: the exact prior page styles and offsets are restored.
  assert.equal(harness.root.classList.contains("is-media-viewer-open"), false);
  assert.equal(harness.body.classList.contains("is-media-viewer-open"), false);
  assert.equal(harness.root.style.overflow, "clip");
  assert.equal(harness.body.style.position, "relative");
  assert.equal(harness.body.style.top, "3px");
  assert.equal(harness.body.style.left, "1px");
  assert.equal(harness.body.style.right, "2px");
  assert.equal(harness.body.style.width, "auto");
  assert.equal(harness.body.style.overflow, "visible");
  assert.equal(harness.body.style.paddingRight, "6px");
  assert.deepEqual(harness.scrollCalls, [[12, 480]]);
});

test("media viewer close control routes through native cleanup", async () => {
  // Given: an open viewer with the page lock active.
  const { createMediaViewer } = await import(socialScriptPath);
  assert.equal(typeof createMediaViewer, "function");
  const harness = mediaViewerHarness();
  const viewer = createMediaViewer(harness.els, harness.options);
  await viewer.open(mediaRecord());

  // When: the visible close control is activated.
  harness.els.dialogClose.emit("click");

  // Then: native close cleanup releases scroll ownership.
  assert.equal(harness.els.dialog.open, false);
  assert.equal(harness.body.classList.contains("is-media-viewer-open"), false);
  assert.deepEqual(harness.scrollCalls, [[12, 480]]);
});

test("media viewer restores page scrolling when native dialog opening fails", async () => {
  // Given: a browser that rejects showModal before the dialog opens.
  const { createMediaViewer } = await import(socialScriptPath);
  assert.equal(typeof createMediaViewer, "function");
  const harness = mediaViewerHarness({ openError: new Error("dialog blocked") });
  const viewer = createMediaViewer(harness.els, harness.options);

  // When: media opening fails.
  const opened = await viewer.open(mediaRecord());

  // Then: the page lock is released and the existing status surface reports the failure.
  assert.equal(opened, false);
  assert.equal(harness.root.classList.contains("is-media-viewer-open"), false);
  assert.equal(harness.body.style.position, "relative");
  assert.deepEqual(harness.scrollCalls, [[12, 480]]);
  assert.deepEqual(harness.toasts, ["Media preview could not be opened."]);
});

test("rejected video playback reveals an announced unavailable state", async () => {
  // Given: a video whose play attempt rejects.
  const { createMediaViewer } = await import(socialScriptPath);
  assert.equal(typeof createMediaViewer, "function");
  const harness = mediaViewerHarness({ playError: new Error("play blocked") });
  const viewer = createMediaViewer(harness.els, harness.options);

  // When: playback rejects.
  const firstOpened = await viewer.open(mediaRecord());

  // Then: the open viewer stops and hides video, exposing a polite status message.
  assert.equal(firstOpened, true);
  assert.equal(harness.els.dialog.open, true);
  assert.equal(harness.els.dialogVideo.hidden, true);
  assert.equal(harness.els.dialogUnavailable.hidden, false);
  assert.equal(harness.els.dialogUnavailable.textContent, "Video preview unavailable.");
  assert.equal(harness.els.dialogUnavailable.getAttribute("role"), "status");
  assert.equal(harness.els.dialogUnavailable.getAttribute("aria-live"), "polite");
  assert.equal(harness.els.dialogUnavailable.getAttribute("aria-atomic"), "true");
  assert.ok(harness.els.dialogVideo.pauseCalls > 0);
});

test("media viewer clears a prior playback failure before the next open", async () => {
  // Given: a viewer that previously entered its playback-unavailable state.
  const { createMediaViewer } = await import(socialScriptPath);
  assert.equal(typeof createMediaViewer, "function");
  const harness = mediaViewerHarness({ playError: new Error("play blocked") });
  const viewer = createMediaViewer(harness.els, harness.options);
  await viewer.open(mediaRecord());
  harness.els.dialog.close();
  harness.els.dialogVideo.playError = null;

  // When: the next valid video opens.
  await viewer.open(mediaRecord({ contentId: "second-video" }));

  // Then: stale failure state is cleared for the valid media.
  assert.equal(harness.els.dialogVideo.hidden, false);
  assert.equal(harness.els.dialogUnavailable.hidden, true);
  assert.equal(harness.els.dialogUnavailable.textContent, "");
});

test("media viewer opens official embedded players without redirecting", async () => {
  const { createMediaViewer } = await import(socialScriptPath);
  const harness = mediaViewerHarness();
  const viewer = createMediaViewer(harness.els, harness.options);

  await viewer.open(mediaRecord({ previewUrl: "", embedUrl: "https://www.youtube.com/embed/video-one", platform: "youtube" }));

  assert.equal(harness.els.dialog.open, true);
  assert.equal(harness.els.dialogVideo.hidden, true);
  assert.equal(harness.els.dialogEmbed.hidden, false);
  assert.equal(harness.els.dialogEmbed.src, "https://www.youtube.com/embed/video-one");
});

test("media viewer clears an embedded player before reopening native media", async () => {
  const { createMediaViewer } = await import(socialScriptPath);
  const harness = mediaViewerHarness();
  const viewer = createMediaViewer(harness.els, harness.options);
  await viewer.open(mediaRecord({ previewUrl: "", embedUrl: "https://www.youtube.com/embed/video-one", platform: "youtube" }));
  harness.els.dialog.close();

  await viewer.open(mediaRecord({ contentId: "native-video" }));

  assert.equal(harness.els.dialogEmbed.hidden, true);
  assert.equal(harness.els.dialogEmbed.src, "");
  assert.equal(harness.els.dialogVideo.hidden, false);
});

test("video error events transition the open viewer to unavailable", async () => {
  // Given: an open video viewer with successful initial playback.
  const { createMediaViewer } = await import(socialScriptPath);
  assert.equal(typeof createMediaViewer, "function");
  const harness = mediaViewerHarness();
  const viewer = createMediaViewer(harness.els, harness.options);
  await viewer.open(mediaRecord());

  // When: the media element reports a runtime error.
  harness.els.dialogVideo.emit("error");

  // Then: the failed video is stopped and the visible status explains the state.
  assert.equal(harness.els.dialog.open, true);
  assert.equal(harness.els.dialogVideo.hidden, true);
  assert.equal(harness.els.dialogUnavailable.hidden, false);
  assert.equal(harness.els.dialogUnavailable.textContent, "Video preview unavailable.");
});

class TestSvgNode {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

class TestClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class TestElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new TestClassList();
    this.hidden = true;
    this.listeners = new Map();
    this.style = {};
    this.textContent = "";
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  emit(name, properties = {}) {
    const event = { target: this, ...properties };
    (this.listeners.get(name) || []).forEach((listener) => listener(event));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "src" || name === "poster") this[name] = "";
  }
}

function mediaViewerHarness({ openError = null, playError = null } = {}) {
  const dialog = new TestElement();
  dialog.open = false;
  dialog.hidden = false;
  dialog.showModal = () => {
    if (openError) throw openError;
    dialog.open = true;
  };
  dialog.close = () => {
    if (!dialog.open) return;
    dialog.open = false;
    dialog.emit("close");
  };
  dialog.cancel = () => {
    dialog.emit("cancel");
    dialog.close();
  };
  const dialogVideo = new TestElement();
  dialogVideo.pauseCalls = 0;
  dialogVideo.playError = playError;
  dialogVideo.pause = () => { dialogVideo.pauseCalls += 1; };
  dialogVideo.load = () => {};
  dialogVideo.play = async () => {
    if (dialogVideo.playError) throw dialogVideo.playError;
  };
  const root = new TestElement();
  root.clientWidth = 1180;
  root.style.overflow = "clip";
  const body = new TestElement();
  Object.assign(body.style, {
    left: "1px",
    overflow: "visible",
    paddingRight: "6px",
    position: "relative",
    right: "2px",
    top: "3px",
    width: "auto",
  });
  const scrollCalls = [];
  const toasts = [];
  const els = {
    dialog,
    dialogCaption: new TestElement(),
    dialogClose: new TestElement(),
    dialogEngagements: new TestElement(),
    dialogEmbed: new TestElement(),
    dialogImage: new TestElement(),
    dialogImpressions: new TestElement(),
    dialogTitle: new TestElement(),
    dialogUnavailable: new TestElement(),
    dialogVideo,
  };
  return {
    body,
    els,
    root,
    scrollCalls,
    toasts,
    options: {
      documentRef: { body, documentElement: root },
      showToast(message) { toasts.push(message); },
      windowRef: {
        innerWidth: 1200,
        scrollX: 12,
        scrollY: 480,
        getComputedStyle() { return { paddingRight: "6px" }; },
        scrollTo(x, y) { scrollCalls.push([x, y]); },
      },
    },
  };
}

function mediaRecord(overrides = {}) {
  return {
    account: "@makeable.build",
    caption: "Building Ember on a real desk",
    contentId: "video-one",
    engagements: 60,
    impressions: 600,
    platform: "instagram",
    previewUrl: "https://media.example.com/ember.mp4",
    publishedAt: "2026-08-25T00:00:00.000Z",
    thumbnailUrl: "https://media.example.com/ember.jpg",
    ...overrides,
  };
}

function allDescendants(node) {
  return node.children.flatMap((child) => [child, ...allDescendants(child)]);
}
