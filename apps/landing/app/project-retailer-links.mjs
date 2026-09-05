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

export function retailerPrice(part, retailer, quote) {
  // A price belongs to its retailer, never to both buttons. Search links are not quotes.
  const merchant = value => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      return /(^|\.)amazon\.(com|co\.uk|ca|de|fr|it|es|co\.jp|in|com\.au)$/.test(url.hostname) ? "amazon" : /(^|\.)aliexpress\.(com|us)$/.test(url.hostname) ? "aliexpress" : null;
    } catch { return null; }
  };
  if (quote?.price?.amount > 0 && Number.isInteger(quote.price.amount) && merchant(quote.destinationUrl) === retailer) {
    try { return { value: new Intl.NumberFormat("en-US", { style: "currency", currency: quote.price.currency }).format(quote.price.amount / 100), status: "Quoted price" }; } catch { /* Use saved estimate below. */ }
  }
  const savedMerchant = merchant(part.url) || (part.asin || part.amazonUrl ? "amazon" : merchant(part.aliexpressUrl));
  if (savedMerchant !== retailer) return { value: "Check price", status: "" };
  const amount = Number(part.unitPriceUsd ?? part.price);
  const labelAmount = String(part.priceLabel || "").match(/\$[\d,]+(?:\.\d{2})?/);
  const value = Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount) : labelAmount?.[0];
  return value ? { value, status: "Estimate" } : { value: "Check price", status: "" };
}
