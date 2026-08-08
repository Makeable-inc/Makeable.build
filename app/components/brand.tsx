export function Logo() {
  return <img className="brand-logo" src="/makeable-logo-v2-cropped.png" alt="Makeable" />;
}

export function SiteFooter() {
  return (
    <footer className="footer shell">
      <Logo />
      <p>Anything is Makeable.</p>
      <div><a href="/#builds">Builds</a><a href="mailto:hello@makeable.build">Contact</a></div>
      <small>© 2026 Makeable. Claude is a trademark of Anthropic PBC. Makeable is not affiliated with Anthropic.</small>
    </footer>
  );
}
