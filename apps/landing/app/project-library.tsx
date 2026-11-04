"use client";
import { useState } from "react";
import "./project-library.css";
type Project = { id: string; title: string; summary: string; image: { url: string }; publishState?: string; createdAt?: string };
export function ProjectLibrary<T extends Project>({ builds, signedIn, onOpen, moreAvailable, loadingMore, onMore }: {
  builds: readonly T[]; signedIn: boolean; onOpen: (build: T) => void;
  moreAvailable?: boolean; loadingMore?: boolean; onMore?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = [...builds].sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .filter(b => `${b.title} ${b.summary}`.toLowerCase().includes(query.trim().toLowerCase()));
  const shown = filtered.slice(0, page * 12);
  return <div className="project-library">
    <div className="project-library-heading"><div><span className="project-library-eyebrow">YOUR WORKSHOP</span><h1 id="workspace-title">{signedIn ? "My builds" : "Community builds"}</h1><p>{signedIn ? "Your ideas, parts and wiring, saved in one place." : "Explore projects made with Makeable."}</p></div><a href="/#make" className="library-primary">Create a build</a></div>
    <div className="project-library-toolbar"><label htmlFor="project-search">Search {signedIn ? "your" : "loaded"} builds<input id="project-search" type="search" placeholder="Find a project…" value={query} onChange={e => {setQuery(e.target.value);setPage(1);}} /></label><span>{filtered.length} {filtered.length === 1 ? "build" : "builds"}{!signedIn && moreAvailable ? " loaded" : ""}</span></div>
    <div className="project-library-grid">{shown.map(build => <article className="library-card" key={build.id}>
      <button className="library-open" onClick={() => onOpen(build)} aria-label={`Open ${build.title}`}><img src={build.image.url} alt="" loading="lazy" /><div><span className="library-visibility">{signedIn ? build.publishState === "hidden" ? "Hidden from community" : "Public in community" : "Community project"}</span><h2>{build.title}</h2><p>{build.summary}</p><span className="library-open-label">Open project →</span></div></button>

    </article>)}</div>
    {!filtered.length && <div className="library-empty"><h2>{query ? "No matching builds" : "Your workshop starts here"}</h2><p>{query ? "Try another title or clear your search." : "Create your first build and it will appear here."}</p>{query && <button onClick={() => setQuery("")}>Clear search</button>}</div>}
    <div className="library-pagination">{shown.length < filtered.length && <button onClick={() => setPage(p=>p+1)}>Show more builds</button>}{moreAvailable && shown.length >= filtered.length && <button onClick={() => {onMore?.();setPage(p=>p+1);}} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more community builds"}</button>}</div>
  </div>;
}
