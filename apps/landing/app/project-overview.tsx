"use client";

import { useEffect, useMemo, useState } from "react";

export type ProjectPart = {
  id?: string;
  name: string;
  category?: string;
  subtype?: string;
  price?: number | null;
  asin?: string;
  url?: string;
  why?: string;
  role?: string;
  listingId?: string;
  amazonUrl?: string;
  aliexpressUrl?: string;
};

export type ProjectOverviewBuild = {
  id: string;
  title: string;
  summary: string;
  behavior?: string;
  status?: string;
  image: { url: string; source?: string };
  parts: ProjectPart[];
  makerName?: string;
  makerHandle?: string;
  makerPicture?: string;
};

type RetailPriceQuote = {
  listingId: string;
  destinationUrl?: string;
  price?: { amount: number; currency: string };
};

const API_ORIGIN = process.env.NEXT_PUBLIC_MAKEABLE_API_ORIGIN
  || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8787" : "");

export function ProjectOverview({ build }: { build: ProjectOverviewBuild }) {
  const [comingSoon, setComingSoon] = useState(false);

  return (
    <div className="mk-project-overview">
      <figure className="mk-project-overview-visual">
        <img src={build.image.url} alt={`${build.title} product render`} />
        <figcaption>
          <small>{build.status || "Concept"}</small>
          <strong>{build.title}</strong>
        </figcaption>
      </figure>
      <section className="mk-project-overview-content" aria-labelledby="workspace-title">
        <header className="mk-project-overview-header">
          <div className="mk-project-brand-row">
            <img src="/makeable-logo-tight.webp" alt="Makeable" />
            <CreatorBadge build={build} />
          </div>
          <h1 id="workspace-title">{build.title}</h1>
          <p>{build.summary}</p>
          <ul className="mk-project-traits" aria-label="Build highlights">
            <li><TraitIcon kind="ready" /> Beginner-friendly</li>
            <li><TraitIcon kind="time" /> 2–3 hours</li>
            <li><TraitIcon kind="gift" /> Great for gifting</li>
          </ul>
          <button className="mk-project-primary-action" type="button" onClick={() => setComingSoon(true)}>
            Make this build <span>Coming soon</span>
          </button>
          {comingSoon && <p className="mk-project-action-status" role="status">Build guides are coming soon.</p>}
        </header>
        <ProjectPartsList parts={build.parts} />
        <footer className="mk-project-trust">
          <span className="mk-detail-trust-mark" aria-label="Makeable"><i aria-hidden="true" /></span>
          <div>
            <strong>All parts link directly to trusted retailers.</strong>
            <span>We select verified, pre-soldered parts to help ensure reliable hardware compatibility.</span>
          </div>
        </footer>
      </section>
    </div>
  );
}

function CreatorBadge({ build }: { build: ProjectOverviewBuild }) {
  const name = build.makerName?.trim() || "Makeable Maker";
  const handle = build.makerHandle?.trim() || `@${name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "makeablemaker"}`;
  return (
    <span className="mk-project-creator">
      <span className="mk-project-creator-avatar" aria-hidden="true">
        <span>{name.charAt(0).toUpperCase() || "M"}</span>
        {build.makerPicture && <img src={build.makerPicture} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
      </span>
      Made by {handle}
    </span>
  );
}

function ProjectPartsList({ parts }: { parts: ProjectPart[] }) {
  const listingIds = useMemo(
    () => [...new Set(parts.map((part) => part.listingId).filter((value): value is string => Boolean(value)))],
    [parts],
  );
  const [quotes, setQuotes] = useState<Record<string, RetailPriceQuote>>({});

  useEffect(() => {
    if (!listingIds.length) return;
    const controller = new AbortController();
    fetch(`${API_ORIGIN}/api/part-prices?listingIds=${encodeURIComponent(listingIds.join(","))}`, { signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as { quotes?: RetailPriceQuote[] } : { quotes: [] })
      .then((payload) => setQuotes(Object.fromEntries((payload.quotes || []).map((quote) => [quote.listingId, quote]))))
      .catch(() => {});
    return () => controller.abort();
  }, [listingIds]);

  return (
    <section className="mk-project-parts" aria-labelledby="project-parts-title">
      <div className="mk-project-parts-head">
        <h2 id="project-parts-title">Part</h2>
        <span>Compare retailer prices</span>
      </div>
      <div className="mk-project-part-list">
        {parts.map((part, index) => {
          const quote = part.listingId ? quotes[part.listingId] : undefined;
          const amazonUrl = quote?.destinationUrl || part.amazonUrl || part.url || retailerSearchUrl("amazon", part.name);
          const aliexpressUrl = part.aliexpressUrl || retailerSearchUrl("aliexpress", part.name);
          return <article className="mk-project-part-card" key={`${part.id || part.asin || part.name}`}>
            <span className={`mk-detail-part-thumb ${partThumbnailClass(part.category)}`} aria-hidden="true" />
            <div className="mk-project-part-copy">
              <strong>{`${index + 1}. ${part.role || partPlainLabel(part)}`}</strong>
              <span>{part.name}</span>
              <details className="mk-detail-part-why">
                <summary>Why we picked this <i aria-hidden="true">i</i></summary>
                <p>{partPurpose(part)}</p>
              </details>
            </div>
            <div className="mk-project-part-retailers" aria-label={`${part.name} retailer options`}>
              <RetailerCard retailer="amazon" price={retailerPrice(part, "amazon", quote)} href={amazonUrl} />
              <RetailerCard retailer="aliexpress" price={retailerPrice(part, "aliexpress")} href={aliexpressUrl} />
            </div>
          </article>;
        })}
      </div>
    </section>
  );
}

function RetailerCard({ retailer, price, href }: { retailer: "amazon" | "aliexpress"; price: string; href: string }) {
  const label = retailer === "amazon" ? "Amazon" : "AliExpress";
  return <a className={`mk-project-retailer mk-project-retailer-${retailer}`} href={href} target="_blank" rel="noopener noreferrer sponsored">
    <span className={`mk-retailer-wordmark mk-retailer-wordmark-${retailer}`}>{retailer === "amazon" ? "amazon" : "AliExpress"}</span>
    <strong>{price}</strong>
    <span>View on {label} <i aria-hidden="true">↗</i></span>
  </a>;
}

function TraitIcon({ kind }: { kind: "ready" | "time" | "gift" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "ready") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" {...common} /><path d="m8.5 12 2.2 2.3 4.8-5" {...common} /></svg>;
  if (kind === "time") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" {...common} /><path d="M12 7.4v5l3 1.7" {...common} /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 10.2h13v9h-13zM12 10.2v9M5.5 13.5h13M12 10.2c0-3.4-5.2-3.7-5.2-.8 0 1.2 1.5 1.8 5.2 1.8M12 10.2c0-3.4 5.2-3.7 5.2-.8 0 1.2-1.5 1.8-5.2 1.8" {...common} /></svg>;
}

function retailerPrice(part: ProjectPart, retailer: "amazon" | "aliexpress", quote?: RetailPriceQuote) {
  if (retailer === "amazon" && quote?.price && Number.isInteger(quote.price.amount) && quote.price.amount > 0) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: quote.price.currency }).format(quote.price.amount / 100);
  }
  const base = typeof part.price === "number" && Number.isFinite(part.price) && part.price > 0 ? part.price : 7.99;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(retailer === "aliexpress" ? Math.max(1.99, base * 0.62) : base);
}

function retailerSearchUrl(marketplace: "amazon" | "aliexpress", partName: string) {
  const query = encodeURIComponent(`${partName} pins soldered`);
  return marketplace === "amazon" ? `https://www.amazon.com/s?k=${query}` : `https://www.aliexpress.us/w/wholesale-${query}.html`;
}

function partThumbnailClass(category?: string) {
  return `mk-detail-part-thumb-${["sensor", "display", "output", "input", "connector"].includes(category?.toLowerCase() || "") ? category!.toLowerCase() : "controller"}`;
}

function partPlainLabel(part: ProjectPart) {
  const text = `${part.category || ""} ${part.subtype || ""} ${part.name || ""}`.toLowerCase();
  if (part.category === "controller") return "The brain";
  if (part.category === "display" || /oled|lcd|display|screen/.test(text)) return "The display";
  if (/soil|water|moisture/.test(text)) return "Plant sensor";
  if (/air quality|pressure|gas|voc|co2/.test(text)) return "Air sensor";
  if (/radar|presence|motion|pir|reed|imu|accelerometer/.test(text)) return "Motion sensor";
  if (/led|rgb|output|light/.test(text)) return "Status light";
  return "Verified module";
}

function partPurpose(part: ProjectPart) {
  return part.why || `${partPlainLabel(part)} selected for this build's main interaction.`;
}
