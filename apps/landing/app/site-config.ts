// Local/staging builds are deliberately not indexable. Production requires an explicit environment setting.
export const siteEnvironment = process.env.MAKEABLE_SITE_ENV || "staging";
export const siteOrigin = new URL(process.env.MAKEABLE_SITE_ORIGIN || "https://makeable.build");
if (siteOrigin.pathname !== "/" || siteOrigin.search || siteOrigin.hash || siteOrigin.protocol !== "https:" || /^(localhost|127\.0\.0\.1)$/.test(siteOrigin.hostname)) {
  throw new Error("MAKEABLE_SITE_ORIGIN must be a public HTTPS origin.");
}
export const productionSite = siteEnvironment === "production";
