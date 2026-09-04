"use client";

import { useEffect, useMemo, useState } from "react";
import { APPROVED_PART_THUMBNAILS } from "./exact-part-thumbnails";
import { projectDisplayIdentity } from "./project-identity.mjs";
import { partPlainLabel, projectPartPurpose } from "./project-part-copy.mjs";
import { RetailerBrand } from "./retailer-brand";
import { projectWiringReady } from "./project-wiring-data.mjs";

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

export function ProjectOverview({ build }: { build: ProjectOverviewBuild }) {
  const identity = projectDisplayIdentity(build);

  return (
    <div className="mk-project-overview">
      <div className="mk-project-overview-primary">
        <figure className="mk-project-overview-visual">
          <ProjectHeroMedia build={build} title={identity.title} />
          <figcaption>
            <small>{projectHeroLabel(build)}</small>
            <strong>{identity.title}</strong>
          </figcaption>
        </figure>
        <section className="mk-project-overview-header" aria-labelledby="workspace-title">
          <h1 id="workspace-title" className="mk-visually-hidden">{identity.title}</h1>
          <div className="mk-project-brand-row">
            <img src="/makeable-logo-tight.webp" alt="Makeable" />
            <CreatorBadge build={build} />
          </div>
          <p>{identity.summary}</p>
          <div className="mk-project-story-grid">
            {build.idea && <div className="mk-project-brief"><span>Your idea</span><p>{build.idea}</p></div>}
            {build.behavior && <div className="mk-project-behavior"><span>How it works</span><p>{build.behavior}</p></div>}
          </div>
          <ul className="mk-project-facts" aria-label="Saved project facts">
            <li><strong>{build.parts.length}</strong><span>matched parts</span></li>
            {build.cost?.estimateLabel && <li><strong>{build.cost.estimateLabel}</strong><span>before shipping and tax</span></li>}
            <li><strong>{projectWiringReady(build) ? "Ready" : "Pending"}</strong><span>wiring guide</span></li>
          </ul>
          <div className="mk-project-readiness" role="status">
            <span aria-hidden="true" />
            <div><strong>Project overview ready</strong><small>Your saved brief and matched parts are kept together under this build ID.</small></div>
          </div>
        </section>
      </div>
      <section className="mk-project-overview-content" aria-label="Project parts and sourcing">
        <ProjectPartsList build={build} parts={build.parts} />
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
      <small>The saved project data is ready, but this local fallback did not generate an exact image.</small>
    </span>;
  }
  return <ProjectImage src={build.image.url} alt={`${title} product render`} />;
}

function projectHeroLabel(build: ProjectOverviewBuild) {
  return build.image.source === "deterministic_build_preview"
    ? "Exact 3D assembly"
    : build.image.source === "preview_fallback" ? "Saved project" : projectAvailabilityLabel(build);
}

function projectAvailabilityLabel(build: ProjectOverviewBuild) {
  if (!build.parts.length) return build.status || "Project preview";
  return "Overview ready";
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

function ProjectPartsList({ build, parts }: { build: ProjectOverviewBuild; parts: ProjectPart[] }) {
  const listingIds = useMemo(
    () => [...new Set(parts.map((part) => part.listingId).filter((value): value is string => Boolean(value)))],
    [parts],
  );
  const [quotes, setQuotes] = useState<Record<string, RetailPriceQuote>>({});

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
        <h2 id="project-parts-title">Parts</h2>
        <span>{build.cost?.estimateLabel || `${parts.length} matched parts`}</span>
      </div>
      <div className="mk-project-part-list" tabIndex={0} role="region" aria-label="Complete parts list — scroll for more parts">
        {parts.map((part, index) => {
          const quote = part.listingId ? quotes[part.listingId] : undefined;
          const amazonUrl = quote?.destinationUrl || part.amazonUrl || part.url || "";
          const aliexpressUrl = part.aliexpressUrl || "";
          const amazonPrice = savedRetailPrice(part, quote);
          return <article className="mk-project-part-card" key={`${part.id || part.asin || part.name}`}>
            <PartThumbnail part={part} />
            <div className="mk-project-part-copy">
              <div className="mk-part-title-row">
                <strong>{`${index + 1}. ${partPlainLabel(part, build)}`}</strong>
                <span className="mk-detail-part-quantity">Qty {part.quantity || 1}</span>
              </div>
              <span>{partDisplayName(part)}</span>
              <small className="mk-part-mobile-facts">Qty {part.quantity || 1} · {amazonPrice || "Price unavailable"}</small>
              {partPackageNote(part) && <span className="mk-part-package-note">{partPackageNote(part)}</span>}
              <details className="mk-detail-part-why">
                <summary>Why we picked this <i aria-hidden="true">i</i></summary>
                <p>{partPurpose(part, build)}</p>
              </details>
            </div>
            <div className="mk-project-part-retailers" aria-label={`${partDisplayName(part)} retailer options`}>
              {amazonUrl && <RetailerCard retailer="amazon" price={amazonPrice} href={amazonUrl} />}
              {aliexpressUrl && <RetailerCard retailer="aliexpress" price={part.priceLabel || null} href={aliexpressUrl} />}
              {!amazonUrl && !aliexpressUrl && <span className="mk-project-retailer-unavailable">Retailer link unavailable</span>}
            </div>
          </article>;
        })}
      {build.cost?.note && <p className="mk-project-cost-note">{build.cost.note}</p>}
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

function RetailerCard({ retailer, price, href }: { retailer: "amazon" | "aliexpress"; price: string | null; href: string }) {
  const label = retailer === "amazon" ? "Amazon" : "AliExpress";
  return <a className={`mk-project-retailer mk-project-retailer-${retailer}`} href={href} target="_blank" rel="noopener noreferrer sponsored">
    <RetailerBrand retailer={retailer} />
    {price && <strong>{price}</strong>}
    <span>Open {label} <i aria-hidden="true">↗</i></span>
    <span className="mk-project-retailer-mobile" aria-hidden="true">Shop ↗</span>
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
  if (part.priceLabel) return part.priceLabel;
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
