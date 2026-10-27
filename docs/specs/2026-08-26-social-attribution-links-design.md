# Social Attribution Links and Account Funnel

## Goal

Give every Makeable social account a stable, unique website link and use it to
measure how many content exposures become real website sessions. The private
dashboard must compare accounts across Instagram, TikTok, YouTube, LinkedIn,
and X without presenting summed views as unique people.

For this feature, a conversion means one attributed website session. Repeated
pageviews in the same session do not create additional conversions.

## Scope

The first implementation covers:

- unique first-party links for `@makeable.build` and `@makeable.zak`;
- a reusable route format for future social accounts;
- session attribution on the Makeable landing page;
- PostHog-backed website-session counts in the private dashboard;
- truthful public-data coverage for `@makeable.zak` until private Instagram
  Insights access is authorized; and
- account ranking by exposures, website sessions, and exposure-to-visit rate.

Platform OAuth synchronization is a later implementation phase. This design
defines the common fields it must populate, but does not require every platform
connection before attribution links work.

## Link Format

Use short, stable, first-party links in social bios:

| Account | Public link |
|---|---|
| Instagram `@makeable.build` | `https://makeable.build/r/ig/makeable-build` |
| Instagram `@makeable.zak` | `https://makeable.build/r/ig/makeable-zak` |

Future links follow the same pattern:

`https://makeable.build/r/<platform>/<account-key>`

Supported platform keys begin with `ig`, `tt`, `yt`, `li`, and `x`. Account
keys use lowercase ASCII letters, digits, and hyphens.

The server resolves each path through a fixed allowlisted mapping and redirects
to the Makeable landing page with these parameters:

```text
utm_source=instagram
utm_medium=organic_social
utm_campaign=makeable
utm_content=makeable_zak_bio
social_account=makeable_zak
social_placement=bio
```

The `utm_source` value identifies the platform. `social_account` identifies the
specific account. `social_placement` leaves room for future bio, profile,
description, and post links. Unknown route keys return 404; the route never
accepts a caller-provided destination, preventing open redirects.

## Attribution Flow

1. A person opens an account-specific `/r/...` link.
2. Makeable redirects to the landing page with the allowlisted attribution
   parameters.
3. The landing page validates the parameters and registers them for the current
   browser session.
4. PostHog records the landing `$pageview` and one `social_landing_view` event
   with platform, account, placement, campaign, and landing URL properties.
5. The dashboard's server queries PostHog for unique sessions grouped by social
   account. A PostHog personal API key and project ID remain server-side.
6. The dashboard joins those session counts to platform exposure metrics using
   the normalized platform and account key.

Attribution is last-touch within the landing session. It is directional rather
than person-level: platform APIs do not reveal which viewer later visited the
website. The dashboard therefore reports an aggregate exposure-to-visit rate,
not a deduplicated audience conversion rate.

If the PostHog read credentials are missing or the query fails, website visits
and conversion rates display `Not connected` or `Unavailable`. They must never
silently become zero.

## Metrics and Inflation Guardrails

The account table is the primary comparison surface.

| Metric | Definition |
|---|---|
| Content exposures | Platform-reported views or impressions; repeat exposure is possible |
| Unique reach | Platform-reported unique viewers, only where available; never summed across platforms |
| Engagements | Available likes, comments, shares, saves, and platform-native interactions |
| Engagement rate | Engagements divided by content exposures |
| Platform link clicks | Platform-reported link taps or link clicks, when available |
| Website conversions | Unique attributed Makeable website sessions |
| Website visit rate | Website conversions divided by content exposures |
| Landing rate | Website conversions divided by platform link clicks, when both are available |

The dashboard may sum content exposures, but the label must remain `Content
exposures` and explain that it is not unique reach. It must not produce a
cross-platform unique-reach total.

The default account ranking is content exposures, with website conversions and
website visit rate immediately adjacent. The rank control also supports website
conversions, website visit rate, and engagement rate.

## Data Coverage

Every account and content record carries a coverage state:

- `connected`: authenticated platform insights plus website attribution;
- `platform-only`: authenticated platform insights without website attribution;
- `public-snapshot`: public views and visible engagement only;
- `attribution-only`: website sessions without connected platform insights; or
- `unavailable`: neither source is currently usable.

`@makeable.zak` enters as `public-snapshot`: five Reels, 47 followers, and 2,486
publicly visible Reel views as observed on 2026-08-26. Public likes and comments
may be shown as partial engagement, but saves, shares, follower attribution,
link taps, and private reach remain unknown. The UI must not compare a partial
engagement rate to a fully connected account without a visible coverage label.

Nullable metrics stay null through parsing, storage, aggregation, and display.
Unknown values are not converted into zero.

## Dashboard Changes

The Social summary rail becomes:

- Content exposures;
- Engagement rate;
- Website conversions;
- Website visit rate;
- Followers gained; and
- Published posts.

The account table shows:

- rank;
- account and coverage state;
- platform;
- content exposures;
- engagement rate;
- platform link clicks;
- website conversions;
- website visit rate;
- followers gained; and
- posts.

The content gallery remains focused on media preview and per-post platform
performance. Website conversion stays account-level unless a platform supports
a genuinely clickable, content-specific link identifier.

## Data Sources and Secrets

The browser-facing PostHog project token remains public and write-only. Reading
aggregated events requires server-only environment variables:

```text
POSTHOG_PERSONAL_API_KEY
POSTHOG_PROJECT_ID
```

No credentials, PostHog personal keys, social access tokens, emails, or personal
identifiers appear in redirect URLs, browser code, dashboard payloads, logs, or
committed files.

## Error Handling

- Unknown short links return a normal 404 page.
- PostHog write failures do not block the visitor from reaching Makeable.
- PostHog read failures show attribution as unavailable and preserve platform
  analytics.
- Partial public metrics are visibly labelled and excluded from comparisons
  that require unavailable fields.
- A platform metric and a PostHog session count are joined only when their
  normalized platform and account identifiers match exactly.

## Verification

Automated tests must prove:

- each short path redirects to the expected fixed landing URL and unique account
  identifier;
- unknown or malformed paths cannot redirect elsewhere;
- landing attribution accepts only supported values and is scoped to one
  session;
- unique sessions are not double-counted by repeated pageviews;
- null metrics remain unknown through import, aggregation, and rendering;
- account ranking produces the correct exposure and website-visit order; and
- dashboard authentication still protects all PostHog-derived analytics.

Manual browser verification must prove:

- both account links land on Makeable without an error;
- the two landings produce different account identifiers;
- the dashboard shows both Instagram accounts and their coverage labels;
- unknown metrics do not render as zero;
- desktop and 375-pixel mobile layouts remain usable; and
- video previews still play inside the dashboard without changing its URL.

