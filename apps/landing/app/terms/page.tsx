import type { Metadata } from "next";
import { LegalShell } from "../legal-shell";

export const metadata: Metadata = {
  title: "Terms | Makeable",
  description: "Terms for using Makeable's early-access product experience.",
};

export default function TermsPage() {
  return (
    <LegalShell eyebrow="Terms" title="Early access, not a finished product" updated="July 20, 2026">
      <p>
        Makeable is currently in early access. The waitlist and pilot program are for evaluation, feedback, and limited access to the product.
      </p>

      <h2>Eligibility and access</h2>
      <p>
        Access may be limited, changed, paused, or revoked at any time. Joining the waitlist does not guarantee access.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>These acceptable-use rules protect the early-access program.</li>
        <li>Do not misuse the service, attempt to bypass limits, or probe systems.</li>
        <li>Do not submit content that is unlawful, abusive, or infringing.</li>
        <li>Do not interfere with authentication, credits, or pilot access controls.</li>
        <li>Use the product only for lawful hardware-design and prototyping workflows.</li>
      </ul>

      <h2>Changes</h2>
      <p>
        We may update these terms as the product changes. Continued use of the waitlist or pilot after an update means you accept the revised terms.
      </p>

      <aside className="mk-legal-note">
        <p>
          Questions about access or these terms: <a href="mailto:makeable.build@gmail.com">makeable.build@gmail.com</a>
        </p>
        <p>
          See the <a href="/privacy/">Privacy Policy</a> for how Google sign-in and waitlist email data are handled.
        </p>
      </aside>
    </LegalShell>
  );
}
