import { mediaKind } from "./social-model.js";

export function renderSocialContent(view, els, mediaViewer, formatters) {
  els.contentGrid.replaceChildren();
  view.content.forEach((record) => {
    const card = document.createElement("article");
    const media = document.createElement("div");
    const body = document.createElement("div");
    card.className = "content-card";
    media.className = "content-media";
    body.className = "content-card-body";
    appendMedia(media, record, mediaViewer);
    body.append(
      metaRow(record),
      textElement("p", record.caption || "Untitled social post", "content-card-caption"),
      statRow(record, formatters.compact),
    );
    card.append(media, body);
    els.contentGrid.append(card);
  });
  els.emptyState.hidden = view.content.length > 0;
  els.contentCount.textContent = `${formatters.number(view.content.length)} videos · ${formatters.number(view.postsTotal)} source posts`;
}

function appendMedia(container, record, mediaViewer) {
  const kind = mediaKind(record);
  if (record.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = record.thumbnailUrl;
    image.alt = `${capitalize(record.platform)} preview for ${record.caption || "social post"}`;
    image.loading = "lazy";
    image.width = 640;
    image.height = 360;
    container.append(image);
  } else if (record.previewUrl) {
    const video = document.createElement("video");
    video.src = record.previewUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-hidden", "true");
    container.append(video);
  } else if (kind === "video") {
    container.append(textElement("p", "Player available", "media-unavailable"));
  } else {
    container.append(textElement("p", "Preview unavailable", "media-unavailable"));
  }
  if (kind === "unavailable") return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "play-control";
  button.setAttribute("aria-label", `${kind === "video" ? "Play" : "View"} ${record.caption || "social preview"}`);
  button.addEventListener("click", () => void mediaViewer.open(record));
  if (kind === "image") button.classList.add("image-control");
  container.append(button);
}

function metaRow(record) {
  const row = document.createElement("div");
  row.className = "content-card-meta";
  const crossPosts = Array.isArray(record.crossPosts) ? record.crossPosts : [record];
  crossPosts.forEach((source) => {
    const badge = source.postUrl ? document.createElement("a") : document.createElement("span");
    badge.className = "content-source-badge";
    badge.textContent = `${capitalize(source.platform)} · ${source.account}`;
    if (source.postUrl) {
      badge.href = source.postUrl;
      badge.target = "_blank";
      badge.rel = "noopener noreferrer";
      badge.setAttribute("aria-label", `Open ${capitalize(source.platform)} post from ${source.account}`);
    }
    row.append(badge);
  });
  return row;
}

function statRow(record, compact) {
  const row = document.createElement("div");
  row.className = "content-card-stats";
  row.append(
    textElement("span", `${compact(record.impressions)} content exposures`),
    textElement("span", `${compact(record.engagements)} engagements`),
  );
  return row;
}

function textElement(name, value, className = "") {
  const element = document.createElement(name);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}
