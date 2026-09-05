"use client";

import { useEffect, useMemo, useState } from "react";
import { APPROVED_PART_THUMBNAILS } from "./exact-part-thumbnails";
import { projectDisplayIdentity } from "./project-identity.mjs";
import { partPlainLabel, projectPartPurpose } from "./project-part-copy.mjs";
import { RetailerBrand } from "./retailer-brand";
import { projectRetailerLink, retailerPrice } from "./project-retailer-links.mjs";
import { projectWiringReady } from "./project-wiring-data.mjs";
import { ArrowIcon } from "./workspace-ui";

export type ProjectPart = {
  id?: string;
  name: string;
  category?: string;
  subtype?: string;
  price?: number | null;
  unitPriceUsd?: number | null;
  priceSource?: string;
  priceLabel?: string;
  asin?: string;
  url?: string;
  why?: string;
  role?: string;
  listingId?: string;
  amazonUrl?: string;
  aliexpressUrl?: string;
  thumbnailUrl?: string;
  quantity?: number;
  packQty?: number;
  packageQuantity?: number;
  includedComponents?: string[];
};

export type ProjectOverviewBuild = {
  id: string;
  title: string;
  idea?: string;
  summary: string;
  behavior?: string;
  status?: string;
  image: { url: string; source?: string };
  parts: ProjectPart[];
  warnings?: string[];
  cost?: {
    estimatedTotalUsd?: number;
    knownSubtotalUsd?: number;
    pricedParts?: number;
    totalParts?: number;
    estimateLabel?: string;
    note?: string;
  };
  artifactStates?: {
    overview?: { state?: string; reason?: string };
    wiring?: { state?: string; reason?: string };
  };
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

export function ProjectOverview({ build, onOpenWiring, wiringLoading = false }: { build: ProjectOverviewBuild; onOpenWiring?: () => void; wiringLoading?: boolean }) {
  const identity = projectDisplayIdentity(build);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  return (
    <div className="mk-overview-frame">
    <div className="mk-project-overview">
      <div className="mk-project-overview-primary">
        <h1 id="workspace-title">{identity.title}</h1>
        <figure className="mk-project-overview-visual">
          <ProjectHeroMedia build={build} title={identity.title} />
        </figure>
        <section className="mk-project-overview-header" aria-labelledby="workspace-title">
          <p id="project-summary" data-expanded={summaryExpanded}>{identity.summary}</p>
          {identity.summary.length > 130 && <button className="mk-summary-toggle" type="button" aria-expanded={summaryExpanded} aria-controls="project-summary" onClick={() => setSummaryExpanded(!summaryExpanded)}>{summaryExpanded ? "Read less" : "Read more"}</button>}
          {build.idea && <details className="mk-project-behavior"><summary>Your idea</summary><p>{build.idea}</p></details>}
          {build.behavior && <details className="mk-project-behavior"><summary>How it works</summary><p>{build.behavior}</p></details>}
          <p className="mk-project-saved-note" role="status">{projectWiringReady(build) ? "Saved · Wiring ready" : "Saved · Wiring not available yet"}</p>
        </section>
      </div>
      <section className="mk-project-overview-content" aria-label="Project parts and sourcing">
        <ProjectPartsList build={build} parts={build.parts} />
      </section>
    </div>
    <footer className="mk-overview-actions">
      <span>Prices are estimates. Check pack size before buying.</span>
      {onOpenWiring && projectWiringReady(build) && <button type="button" onClick={onOpenWiring} disabled={wiringLoading}>{wiringLoading ? "Opening guide…" : "Open wiring"} <ArrowIcon /></button>}
    </footer>
    </div>
  );
}

function ProjectHeroMedia({ build, title }: { build: ProjectOverviewBuild; title: string }) {
  if (build.image.source === "deterministic_build_preview") {
    const simulatorSrc = `/circuit-studio/?mode=guide&embed=1&sourceBuildId=${encodeURIComponent(build.id)}`;
    return (
      <iframe
        className="mk-project-overview-exact-assembly"
        title={`Exact 3D assembly for ${title}`}
        src={simulatorSrc}
        loading="eager"
        allow="fullscreen"
      />
    );
  }
  if (build.image.source === "preview_fallback") {
    return <span className="mk-project-preview-unavailable" role="img" aria-label={`Generated product render unavailable for ${title}`}>
      <span className="mk-preview-mark" aria-hidden="true"><i /><i /><i /></span>
      <strong>Product render unavailable</strong>
      <small>Your parts list is saved.</small>
    </span>;
  }
  return <ProjectImage src={build.image.url} alt={`${title} product render`} />;
}

function ProjectPartsList({ build, parts }: { build: ProjectOverviewBuild; parts: ProjectPart[] }) {
  const listingIds = useMemo(
    () => [...new Set(parts.map((part) => part.listingId).filter((value): value is string => Boolean(value)))],
    [parts],
  );
  const [quotes, setQuotes] = useState<Record<string, RetailPriceQuote>>({});
  const [partIndex, setPartIndex] = useState(0);
  const currentPart = Math.min(partIndex, Math.max(0, parts.length - 1));

  useEffect(() => {
    setQuotes({});
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
        <h2 id="project-parts-title">Your parts</h2>
        <span>{build.cost?.estimateLabel || `${parts.length} matched parts`}</span>
        <nav className="mk-parts-pagination" aria-label="Browse parts">
          <button type="button" aria-label="Previous part" disabled={currentPart === 0} onClick={() => setPartIndex(currentPart - 1)}><ArrowIcon direction="left" /></button>
          <span aria-live="polite">{parts.length ? currentPart + 1 : 0} of {parts.length}</span>
          <button type="button" aria-label="Next part" disabled={currentPart >= parts.length - 1} onClick={() => setPartIndex(currentPart + 1)}><ArrowIcon /></button>
        </nav>
      </div>
      <div className="mk-project-part-list" tabIndex={0} role="region" aria-label="Complete parts list — scroll for more parts">
        {parts.map((part, index) => {
          const quote = part.listingId ? quotes[part.listingId] : undefined;
          const amazon = projectRetailerLink(part, "amazon", quote?.destinationUrl);
          const aliexpress = projectRetailerLink(part, "aliexpress");
          return <article className="mk-project-part-card" data-mobile-current={index === currentPart} key={`${part.id || part.asin || part.name}`}>
            <PartThumbnail part={part} />
            <div className="mk-project-part-copy">
              <div className="mk-part-title-row">
                <strong>{partPlainLabel(part, build).replace(/^The brain$/, "Controller").replace(/^The display$/, "Display")}</strong>
                <span className="mk-detail-part-quantity">Qty {part.quantity || 1}</span>
              </div>
              <details className="mk-detail-part-why">
                <summary>Part details</summary>
                <p>{partDisplayName(part)}</p>
                {partPackageNote(part) && <p>{partPackageNote(part)}</p>}
                <p>{partPurpose(part, build)}</p>
              </details>
            </div>
            <div className="mk-project-part-retailers" aria-label={`${partDisplayName(part)} retailer options`}>
              <RetailerCard retailer="amazon" partName={part.name} price={retailerPrice(part, "amazon", quote)} {...amazon} />
              <RetailerCard retailer="aliexpress" partName={part.name} price={retailerPrice(part, "aliexpress")} {...aliexpress} />
            </div>
          </article>;
        })}
      <details className="mk-project-buying-note"><summary>Before you buy</summary><p className="mk-project-retailer-note">Search links are not verified matches. Check the model, pins and pack size. Shipping and tax are extra.</p>{build.cost?.note && <p className="mk-project-cost-note">{build.cost.note}</p>}</details>
      {Boolean(build.warnings?.length) && <details className="mk-project-warnings">
        <summary>Compatibility notes</summary>
        <ul>{build.warnings?.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </details>}
      </div>
    </section>
  );
}

export function PartThumbnail({ part }: { part: ProjectPart }) {
  const thumbnail = approvedPartThumbnail(part);
  if (!thumbnail) {
    return <span className="mk-detail-part-thumb mk-detail-part-thumb-neutral" aria-hidden="true"><span>Part</span></span>;
  }
  return <span className="mk-detail-part-thumb mk-detail-part-thumb-exact" data-visual-match={thumbnail.status} aria-hidden="true">
    <img
      src={thumbnail.url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      data-visual-layout="single"
    />
  </span>;
}

export function ProjectImage({ src, alt }: { src: string; alt: string }) {
  const [readySrc, setReadySrc] = useState("");
  const [failedSrc, setFailedSrc] = useState("");
  useEffect(() => {
    let active = true;
    if (!src) return () => { active = false; };
    const probe = new Image();
    probe.onload = () => { if (active) setReadySrc(src); };
    probe.onerror = () => { if (active) setFailedSrc(src); };
    probe.src = projectAssetUrl(src);
    return () => { active = false; };
  }, [src]);
  const state = !src || failedSrc === src ? "failed" : readySrc === src ? "ready" : "checking";
  if (state !== "ready") {
    const unavailable = state === "failed";
    return <span className="mk-build-image-fallback" role="img" aria-label={unavailable ? `${alt} unavailable` : `Loading ${alt}`}><span>{unavailable ? "Preview unavailable" : "Loading preview"}</span></span>;
  }
  return <img src={projectAssetUrl(src)} alt={alt} onError={() => setFailedSrc(src)} />;
}

function projectAssetUrl(value: string) {
  return value.startsWith("/api/") ? `${API_ORIGIN}${value}` : value;
}

function approvedPartThumbnail(part: ProjectPart) {
  const identityKeys = [part.asin, part.id, part.listingId]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toUpperCase());
  const selected = identityKeys.map((key) => APPROVED_PART_THUMBNAILS[key]).find(Boolean);
  if (!selected || !isTrustedPartThumbnailUrl(selected.url)) return null;

  // A same-host URL is not sufficient evidence of identity. The generated
  // registry wins even when a legacy payload supplies another trusted image.
  return selected;
}

function isTrustedPartThumbnailUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "dvy6bet209exg.cloudfront.net") return false;
    return /\.(?:jpe?g|png|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function RetailerCard({ retailer, href, isSearch, partName, price }: { retailer: "amazon" | "aliexpress"; href: string; isSearch: boolean; partName: string; price: { value: string; status: string } }) {
  const label = retailer === "amazon" ? "Amazon" : "AliExpress";
  return <a className={`mk-project-retailer mk-project-retailer-${retailer}`} href={href} target="_blank" rel="noopener noreferrer sponsored" aria-label={`${isSearch ? "Search" : "View listing on"} ${label} for ${partName} (opens in a new tab)`}>
    <RetailerBrand retailer={retailer} />
    <strong className="mk-offer-price">{price.value}</strong>
    <small className="mk-offer-status">{price.status || "Price on retailer"}</small>
    <span className="mk-retailer-action">{isSearch ? "Search" : "View listing"} <i aria-hidden="true">↗</i></span>
  </a>;
}

function partPackageNote(part: ProjectPart) {
  const notes = [];
  const packageQuantity = Number(part.packageQuantity || part.packQty || 1);
  if (packageQuantity > 1) notes.push(`${packageQuantity} included in the pack`);
  if (part.includedComponents?.length) notes.push(`Includes ${part.includedComponents.join(" and ")}`);
  return notes.join(" · ");
}

function savedRetailPrice(part: ProjectPart, quote?: RetailPriceQuote) {
  if (quote?.price && Number.isInteger(quote.price.amount) && quote.price.amount > 0) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: quote.price.currency }).format(quote.price.amount / 100);
  }
  if (part.priceLabel) return part.priceLabel.replace(/^About\s+(\$[\d,.]+)\s+planning estimate$/i, "$1 estimate");
  const amount = typeof part.unitPriceUsd === "number" && Number.isFinite(part.unitPriceUsd) && part.unitPriceUsd > 0
    ? part.unitPriceUsd
    : typeof part.price === "number" && Number.isFinite(part.price) && part.price > 0
      ? part.price
      : null;
  if (amount == null) return null;
  const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  return part.priceSource === "planning-estimate" ? `About ${formatted}` : formatted;
}

export function partDisplayName(part: ProjectPart) {
  return approvedPartThumbnail(part)?.displayName || part.name;
}

export { partPlainLabel };

export function partPurpose(part: ProjectPart, build?: ProjectOverviewBuild) {
  return projectPartPurpose(part, build);
}
