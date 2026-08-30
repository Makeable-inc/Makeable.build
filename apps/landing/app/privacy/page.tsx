import type { Metadata } from "next";
import { LegalShell } from "../legal-shell";

export const metadata: Metadata = {
  title: "Privacy | Makeable",
  description: "How Makeable handles sign-in, waitlist, and product analytics data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="Privacy" title="What we collect and why" updated="August 25, 2026">
      <p>
        Google sign-in supplies your name, email address, and email verification status, plus a stable account identifier, and may supply a profile image URL. Makeable uses those account details to keep you signed in, show your profile, and connect saved builds to your account. New waitlist records contain your name and email, but not your Google account identifier or profile image.
      </p>

      <h2>How we use it</h2>
      <p>
        We store your email address in Makeable's waitlist storage so we can manage the waitlist and send pilot-access communications. The hosted deployment uses Netlify Blobs. If you join through Google sign-in, we may also keep your name to personalize the invitation. We deduplicate by normalized email address and never store your Google credential token.
      </p>

      <h2>Analytics</h2>
      <p>
        We use PostHog to understand visits and actions such as opening a preorder, starting checkout, submitting a build idea, and completing Google sign-in. PostHog receives an anonymous browser identifier and, after sign-in, a one-way pseudonymous Makeable account identifier so activity can be counted across visits. PostHog receives event details, not your email address, name, Google account identifier, or Google credential. Inputs are masked in session recordings.
      </p>

      <h2>Remembering your signup</h2>
      <p>
        After a verified sign-in, Makeable stores a random, HttpOnly browser session cookie so the same browser can recognize your account. The cookie is not a Google credential, contains no email address, cannot be read by page JavaScript, and expires after one year. Removing browser cookies means you may need to sign in with Google again.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your email address or Google profile data.</li>
        <li>We do not use Google sign-in data for ad targeting.</li>
        <li>We do not ask for more Google data than we need for sign-in, saved builds, and the waitlist.</li>
      </ul>

      <h2>Retention and removal</h2>
      <p>
        We keep waitlist records until they are no longer needed for pilot access or product communication. You can ask us to remove your record at any time.
      </p>

      <aside className="mk-legal-note">
        <p>
          Removal requests and privacy questions: <a href="mailto:makeable.build@gmail.com">makeable.build@gmail.com</a>
        </p>
        <p>
          Read the <a href="/terms/">Terms</a> for the early-access and acceptable-use rules.
        </p>
      </aside>
    </LegalShell>
  );
}
