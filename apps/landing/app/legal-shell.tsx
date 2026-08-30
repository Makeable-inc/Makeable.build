import type { ReactNode } from "react";

type LegalShellProps = Readonly<{
  title: string;
  eyebrow: string;
  updated: string;
  children: ReactNode;
}>;

export function LegalShell({ title, eyebrow, updated, children }: LegalShellProps) {
  return (
    <main className="mk-legal-page">
      <header className="mk-legal-nav">
        <a className="mk-legal-home" href="/" aria-label="Makeable home">
          <img src="/makeable-logo-tight.webp" alt="Makeable" />
        </a>
        <nav className="mk-legal-nav-links" aria-label="Legal pages">
          <a href="/terms/">Terms</a>
          <a href="/privacy/">Privacy</a>
        </nav>
      </header>

      <section className="mk-legal-document" aria-labelledby="legal-title">
        <div className="mk-legal-heading">
          <p>{eyebrow}</p>
          <h1 id="legal-title">{title}</h1>
          <span>Last updated: {updated}</span>
        </div>
        <div className="mk-legal-copy">{children}</div>
      </section>

      <footer className="mk-legal-footer">
        <span>© Makeable 2026</span>
        <span aria-hidden="true">·</span>
        <a href="/">Home</a>
        <span aria-hidden="true">·</span>
        <a href="/terms/">Terms</a>
        <span aria-hidden="true">·</span>
        <a href="/privacy/">Privacy</a>
      </footer>
    </main>
  );
}
