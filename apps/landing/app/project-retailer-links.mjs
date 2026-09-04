// Saved listings stay authoritative. Missing listings are clearly labelled searches,
// never inferred product matches or price quotes.
export function projectRetailerLink(part, retailer, destinationUrl) {
  const candidates = retailer === "amazon"
    ? [destinationUrl, part.amazonUrl, part.url]
    : [part.aliexpressUrl, part.url];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      const domain = retailer === "amazon"
        ? /(^|\.)amazon\.(com|co\.uk|ca|de|fr|it|es|co\.jp|in|com\.au)$/
        : /(^|\.)aliexpress\.(com|us)$/;
      if (url.protocol !== "https:" || !domain.test(url.hostname) || url.username || url.password) continue;
      const isListing = retailer === "amazon"
        ? /\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/i.test(url.pathname)
        : /\/item\/\d+\.html$/i.test(url.pathname);
      return { href: url.href, isSearch: !isListing };
    } catch { /* Fall through to an explicitly labelled retailer search. */ }
  }
  const query = encodeURIComponent(part.name.trim());
  return {
    href: retailer === "amazon"
      ? `https://www.amazon.com/s?k=${query}`
      : `https://www.aliexpress.com/w/wholesale-${query}.html`,
    isSearch: true,
  };
}
