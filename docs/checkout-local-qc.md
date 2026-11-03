# Checkout confirmation: local QC

Work from this checkout, not the separate landing redesign:
`/Users/nyan/Documents/ChatGPT/Makeable-issue-26`

## Preview

With Node 24+ and npm installed:

```sh
npm ci
npm run qc:checkout
```

Open http://localhost:3001/__checkout-qc. Choose a scenario to see the real
homepage and checkout confirmation. No Stripe account, keys, real payment,
AWS connection or deployment is needed. The local server uses memory storage,
dummy Stripe credentials, and replaces outside service requests. The scenario
page and fake responses are local script code; they are not in the deployed app.

The first run builds the packaged site, matching the production build. After
editing the UI, stop the server and run the same command again to rebuild.
To reopen an unchanged build faster: `npm run qc:checkout -- --skip-build`.
Stop with Ctrl+C. Use `--port 3002` if port 3001 is occupied.

## Review checklist

- Paid: centered modal with a dimmed background; Continue browsing is the only dismissal. Escape, backdrop clicks and background controls cannot dismiss or bypass it. No shipment promise.
- Slow: checking state for five seconds, then verified confirmation.
- Pending: no paid claim; Check again is available.
- Error: neutral explanation, retry and contact link.
- Cancelled: cancellation notice, without a paid claim.
- Success URL without a session and invalid session: never show confirmation.
- Dismissal: returns to browsing and removes only checkout/session URL parameters.
- Desktop and phone: readable, no clipped actions; keyboard can reach every action.

The page never creates an order or triggers fulfillment. Its only payment request
is GET /api/checkout/status. Real fulfillment remains with signed webhooks.
Local fakes test our UI and API contract; they do not prove live Stripe or AWS
configuration. After local QC, verify the eventual deployment separately.

## Automated checks

```sh
npm run build
npm run test:checkout
```

Install Chromium once if Playwright asks: `npx playwright install chromium`.
The tests run desktop and phone layouts, exercise the real status API against
fake Stripe, assert visible confirmation for a created session, preserve the
existing signed-webhook checks, and test error/retry without creating a charge.

Nothing in these commands commits, pushes, merges, or deploys.
