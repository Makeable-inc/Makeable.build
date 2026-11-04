# Local website readiness review

This change targets `staging`. Merging and deployment remain separate from local review.

## Preview

Build with `npm run build`. Then run:

```
npm run qc:checkout -- --skip-build --port 3201 --fixtures tests/e2e/fixtures.mjs --ai-replay tests/e2e/recordings/desk-thermometer
```

Open http://localhost:3201. Local test account: http://localhost:3201/__local-login?next=/app/ . This preview uses in-memory fixture builds, recorded AI responses and fake Stripe; it cannot charge buyers. Restarting resets fixture visibility. The plain `dev:local` command can call real services if credentials are present; use the command above for this review.

## Environment and crawling

The default build is staging (`noindex, nofollow`, robots disallow all). This includes the legacy Ember pages. For public production, set these **at build time** and rebuild:

```
MAKEABLE_SITE_ENV=production MAKEABLE_SITE_ORIGIN=https://makeable.build npm run build
```

`MAKEABLE_SITE_ORIGIN` must be a public HTTPS origin, with no path. `/app/` remains noindex even in production. These settings must be added to the deployment build environment before cutover; no deployment settings were changed here. Robots directives are indexing controls, not access control.

## Read-only old/new verification

```
npm run verify:site -- https://NEW-STAGING-HOST
npm run verify:site -- https://OLD-PRODUCTION-HOST --production
# For two hosts that have the same indexing policy:
npm run verify:site -- https://FIRST-HOST https://SECOND-HOST --production
```

The command checks critical routes, metadata for local preview addresses, indexing, 404 recovery, shared download links and the existing installer redirect. It uses GET/HEAD only, does not sign in or create orders, and does not download the installer body. Exit code is nonzero when a check fails. An old site lacking a new route will be reported as a failure for review, not changed.

## Scope and decisions before deployment

- Own builds are searched locally and displayed 12 at a time. The existing account API still returns the owner's collection in one request; public gallery requests are bounded at 24 with cursor pagination. Deep links retrieve a missing project by ID, never request the unbounded public gallery.
- The My builds collection does not expose a hide control. The existing backend visibility endpoint and previously hidden records remain supported.
- All Ember buttons use `/ember/download`. Its existing CloudFront redirect is preserved (currently **0.2.21 Developer Preview, Apple silicon**). This resolves conflicting links but **does not certify that release for customers**. The team must approve the artifact; no new release was uploaded.
- Setup guidance retains macOS 14+, Apple silicon, USB-C power and Bluetooth. It needs a real-device walkthrough against the approved app before publication; browser tests cannot validate hardware pairing or installation.
- `lib/ember-offer.mjs` supplies displayed price, checkout defaults, supported existing backend markets/colors, shipping and Stripe description. UI remains Beige/US/one kit; no extra selections added.
- The obsolete October 2026 promise is replaced by **Pre-orders are expected to ship by end November 2026.** in both the website and new Stripe sessions, as requested by the user. Existing orders and Stripe Dashboard products are not edited.
- Existing privacy/terms content and cutover DNS, old URL redirects, analytics consent and hardware/firmware functionality were not redesigned by this bounded change.

## Verification

```
npm test
npm run test:e2e -- tests/e2e/readiness.spec.mjs tests/e2e/accounts.spec.mjs tests/e2e/visibility.spec.mjs tests/e2e/public-browsing.spec.mjs tests/e2e/checkout.spec.mjs tests/e2e/checkout-return.spec.mjs tests/e2e/surfaces.spec.mjs
CAPTURE_PHASE=after READINESS_REVIEW_DIR=/absolute/review-folder npm run test:e2e -- tests/e2e/readiness-captures.spec.mjs
```

The capture spec is opt-in and skipped in regular CI. Images use fixed, synthetic test data rather than private customer builds.
