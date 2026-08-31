export class SocialRefreshError extends Error {
  constructor(platform, status, detail = "") {
    super(`${platform} refresh failed (${status}).`);
    this.platform = platform;
    this.status = status;
    this.detail = string(detail).replace(/\s+/g, " ").slice(0, 240);
  }
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}
