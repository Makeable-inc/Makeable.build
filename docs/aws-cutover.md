# Cutover: makeable.build from Netlify to AWS

The steps to move the live site from Netlify to the AWS stack (`makeable-prod`, Amplify site). Until the DNS switch, Netlify is production and AWS is the test site. The switch needs the owner's go-ahead and a date.

Tick each step in the PR or issue that tracks the cutover; don't edit this file to record progress.

## Before the switch

1. **Ember download.** `/ember/download` in `netlify.toml` points at the same file as the live site (CloudFront Ember 0.2.21). Done in #22.
2. **Secrets.** Copy the remaining production values from Netlify into the Secrets Manager secret `makeable/prod`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MAKEABLE_DRAFT_COOKIE_SECRET`, `MAKEABLE_BACKGROUND_SECRET`, `DASHBOARD_SESSION_SECRET`, `MAKEABLE_ANALYTICS_ID_SECRET`, `DASHBOARD_ACCESS_KEY`, `POSTHOG_PERSONAL_API_KEY`. Social keys can follow later. Never print or commit them.
3. **Test records.** Delete test data left on AWS: earlier smoke builds (before #23 the smoke build stayed in the gallery) and builds made by hand on the test site.
4. **Stripe.** Send one test webhook through the Amplify URL and check it is recorded.
5. **Freeze Netlify.** Stop new builds on Netlify (set `MAKEABLE_BUILD_GENERATION_ENABLED=0` and leave `MAKEABLE_ATOMIC_BUILD_GENERATION_ENABLED` unset there, then redeploy) and wait for builds already running to finish.
6. **Final data copy.** With `AWS_PROFILE=makeable`:
   - `node scripts/migrate-blobs.mjs` (dry run: counts per store)
   - `node scripts/migrate-blobs.mjs --apply --delete-extra` (copies new and changed records, deletes S3 records Netlify no longer has)
   - `node scripts/migrate-blobs.mjs --apply --archive` (raw backup of every Netlify store under `netlify-archive/`)
   - `node scripts/migrate-blobs.mjs --verify` (compares S3 with Netlify; must report no differences)
   - `node scripts/index-gallery-owners.mjs` (rebuilds the My builds index from the copied records)
7. **Deploy with production settings.** `sam deploy` with `PublicOrigin=https://makeable.build`, `SchedulesState=ENABLED` and `TrustedProxyHops=1`. Turn Netlify's scheduled functions (build cleanup, social refresh) off at the same time, so the jobs never run twice.
8. **Domain.** Add `makeable.build` and `www` as Amplify custom domains (`www` redirects to the apex, as on Netlify) and add Amplify's certificate validation CNAME in Cloudflare.

## The switch

9. **DNS.** In Cloudflare, point `makeable.build` and `www` at Amplify. Proxy status must be **DNS only (grey cloud)**, never proxied (orange): proxied makes every visitor look like Cloudflare's IP, which breaks the rate limits that `TrustedProxyHops=1` relies on, and breaks Amplify's certificate.

## After the switch

10. On https://makeable.build: one real build (`scripts/aws-smoke-build.mjs --base https://makeable.build`), Google sign-in, My builds shows existing builds, the community gallery loads, `/ember` and `/ember/download` work, the dashboard opens with its key.
11. One real Stripe test payment, and check the webhook is recorded.
12. Keep Netlify for one week as the rollback.

## Rollback

Point DNS back at Netlify, turn its build generation and scheduled functions back on, and copy any data created on AWS since the switch back to Netlify Blobs. Data written on AWS after the switch is not on Netlify until it is copied back.
