'use strict';

const DEFAULT_WINDOW = Object.freeze({ width: 1100, height: 760 });
const MIN_WINDOW = Object.freeze({ width: 760, height: 560 });
const WORK_AREA_MARGIN = 24;

function finiteRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const normalized = {
    x: Number(rect.x),
    y: Number(rect.y),
    width: Number(rect.width),
    height: Number(rect.height),
  };
  return Object.values(normalized).every(Number.isFinite) && normalized.width > 0 && normalized.height > 0
    ? normalized
    : null;
}

function intersectionArea(left, right) {
  const a = finiteRect(left);
  const b = finiteRect(right);
  if (!a || !b) return 0;
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function fitToWorkArea(workArea, desired = DEFAULT_WINDOW, margin = WORK_AREA_MARGIN) {
  const area = finiteRect(workArea) || { x: 0, y: 0, width: DEFAULT_WINDOW.width, height: DEFAULT_WINDOW.height };
  const safeMargin = Math.max(0, Math.min(Number(margin) || 0, Math.floor(Math.min(area.width, area.height) / 4)));
  const availableWidth = Math.max(360, area.width - safeMargin * 2);
  const availableHeight = Math.max(420, area.height - safeMargin * 2);
  const width = Math.min(Math.max(MIN_WINDOW.width, Number(desired?.width) || DEFAULT_WINDOW.width), availableWidth);
  const height = Math.min(Math.max(MIN_WINDOW.height, Number(desired?.height) || DEFAULT_WINDOW.height), availableHeight);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function restoreOrFit(savedBounds, displays, primaryWorkArea, desired = DEFAULT_WINDOW) {
  const saved = finiteRect(savedBounds);
  const workAreas = (Array.isArray(displays) ? displays : [])
    .map((display) => finiteRect(display?.workArea || display))
    .filter(Boolean);
  if (saved) {
    const bestArea = workAreas.reduce((largest, area) => Math.max(largest, intersectionArea(saved, area)), 0);
    // Require enough of the title bar and content to remain reachable. A tiny
    // one-pixel intersection is not a useful restored window.
    if (bestArea >= Math.min(saved.width * saved.height * 0.35, 240_000)) {
      const containing = workAreas.find((area) => intersectionArea(saved, area) === bestArea) || primaryWorkArea;
      const fitted = fitToWorkArea(containing, saved, 8);
      return { ...fitted, restored: true };
    }
  }
  return { ...fitToWorkArea(primaryWorkArea, desired), restored: false };
}

module.exports = {
  DEFAULT_WINDOW,
  MIN_WINDOW,
  WORK_AREA_MARGIN,
  finiteRect,
  intersectionArea,
  fitToWorkArea,
  restoreOrFit,
};
