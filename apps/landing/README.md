# Makeable Ember landing page

This package contains the scroll-controlled Ember product story used by the
public Makeable landing page. It exports a static frontend which the
repository-level Netlify build combines with Makeable's existing pages.

## Run locally

```bash
npm install
npm run dev
```

Node.js 24 is required.

## Deploy on Netlify

Connect the repository and deploy `main` from the repository root. The root
`netlify.toml` builds this package, combines it with the legacy public routes,
and deploys the existing Netlify functions.

- Base directory: leave blank (repository root)
- Build command: supplied by `netlify.toml`
- Publish directory: `dist`

## Production checkout

Set `STRIPE_SECRET_KEY` in the deployment environment. The key must remain
server-side and must never be committed to this repository.

Set `STRIPE_WEBHOOK_SECRET` to the signing secret for the endpoint at
`https://makeable.build/api/stripe/webhook`. The endpoint verifies every Stripe
event before recording pseudonymous `order paid`, checkout-expiry, async-payment,
and refund events in PostHog. Do not send customer email, address, payment, or
Stripe session IDs to PostHog.

Checkout requires the customer's name, phone number, billing address, and
shipping address. Shipping is available to Singapore, the United States,
Canada, the United Kingdom, Australia, and New Zealand by default. To change
that list, set `STRIPE_ALLOWED_SHIPPING_COUNTRIES` to comma-separated two-letter
country codes, for example `SG,MY,ID,TH,PH,VN`.

## Animation assets

- Desktop: `public/frames-v2` (301 optimized WebP frames)
- Mobile: `public/frames-mobile` (300 optimized WebP frames)

The page automatically selects the appropriate sequence for the visitor's
viewport while preserving the same four scroll-controlled scenes.
