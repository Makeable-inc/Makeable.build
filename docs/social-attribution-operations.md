# Social Attribution Operations

## Live Instagram bio links

Use these exact first-party links in the matching Instagram account bio:

| Account | Bio link |
| --- | --- |
| Instagram `@makeable.build` | `https://makeable.build/r/ig/makeable-build` |
| Instagram `@makeable.zak` | `https://makeable.build/r/ig/makeable-zak` |

Each route is an allowlisted server redirect. It adds the account-specific
attribution values and sends the visitor to the Makeable landing page. Do not
append a destination, redirect, or account query parameter to either route.

Changing an Instagram bio is an external, public account action. The account
owner must authorize and make the exact change in Instagram; this local
implementation does not perform that action. Do not request, paste, or store an
Instagram password, access token, or PostHog key in chat, source control, or a
CSV.

## Server configuration

Configure these variables only in the server or hosting provider's private
environment configuration:

| Variable | Required value | Purpose |
| --- | --- | --- |
| `POSTHOG_PERSONAL_API_KEY` | A server-only PostHog personal key | Authenticates the aggregate PostHog query. |
| `POSTHOG_PROJECT_ID` | Numeric PostHog project ID | Selects the PostHog project for that query. |

These are read only after dashboard authentication and must never be placed in
browser code, public environment variables, redirect URLs, API responses, logs,
or committed files. The browser-facing PostHog project token is not a
replacement for the personal API key and cannot read these aggregates.

## What the dashboard means

- **Content exposures** are platform-reported views or impressions. They can
  include repeat views and are not a unique-people or cross-platform reach
  total.
- **Website conversion** means one unique attributed Makeable website session.
  Repeated page views in that same session do not add conversions. If a session
  arrives through more than one social account, its latest social landing wins,
  so the cross-account total cannot count that session twice.
- **Website visit rate** is website conversions divided by content exposures.
  It is an aggregate, directional exposure-to-visit measure—not a
  person-level conversion rate.
- **Platform link clicks** remain unknown when the platform has not provided
  the metric; they must not be entered or interpreted as zero.

### Attribution query status

| Status | Meaning | Dashboard treatment |
| --- | --- | --- |
| `connected` | Both PostHog variables are usable and the aggregate query succeeded. | Website conversions can show a real zero when no matching sessions exist. |
| `not_connected` | One or both PostHog variables are absent. | Website conversions and visit rate show **Not connected**, never zero. |
| `unavailable` | Credentials were present but the query, response validation, or request failed. | Website conversions and visit rate show **Unavailable**, never zero. |

Coverage labels describe the source quality of social-content data separately
from the PostHog query: **Connected** is authenticated platform insights plus
website attribution; **Platform only** is authenticated platform insights
without website attribution; **Public snapshot** is public views and visible
engagement only; **Attribution only** is website sessions without platform
insights; and **Unavailable** means neither source is usable. `@makeable.zak`
currently carries the **Public snapshot** label.

The conversion query covers the most recent 90 days. The content dashboard
ships with the eight verified Instagram snapshots (three `@makeable.build` and
five `@makeable.zak`); later authenticated imports update matching posts by
platform, account, and content ID instead of duplicating them.

## Instagram rollout

1. Confirm the dashboard deployment has private `POSTHOG_PERSONAL_API_KEY` and
   numeric `POSTHOG_PROJECT_ID` values. Do not expose their values while
   checking.
2. Check the two routes return distinct `302` redirects and a `Cache-Control:
   no-store` header. An unknown account route must return `404`.
3. Have the authorized owner replace each Instagram bio link with the exact
   matching URL in the table above. This is an external public write and is not
   performed by this repository or local server.
4. Open each resulting landing page once and then verify Social shows the
   expected account key and a non-zero conversion only after PostHog has
   processed the event. Do not promise real-time reporting.
5. Keep the account label, public-data coverage, and imported content records
   truthful. A missing metric remains unknown; do not use `0` as a placeholder.

## Adding future platforms or accounts

The future public shape is
`https://makeable.build/r/<platform>/<account-slug>`, but a URL works only once
it has an explicit allowlist entry and tests. Proposed patterns are:

| Platform | Future pattern |
| --- | --- |
| TikTok | `https://makeable.build/r/tiktok/<account-slug>` |
| YouTube | `https://makeable.build/r/youtube/<account-slug>` |
| LinkedIn | `https://makeable.build/r/linkedin/<account-slug>` |
| X | `https://makeable.build/r/x/<account-slug>` |

For each addition, choose a stable lowercase account key (letters, digits, and
underscores), add an exact allowlisted route, preserve the standard attribution
fields, add redirect and dashboard tests, and obtain the relevant account
owner's authorization before making any public profile change. Never turn the
route into an open redirect or accept an arbitrary destination parameter.
