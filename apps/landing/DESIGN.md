# Makeable Landing Design System

## 1. Atmosphere & Identity

Makeable pairs a dark workshop hero with a light, softly color-washed discovery surface. The signature is a product gallery whose white cards are identified by precise, colored perimeter rings rather than heavy shadows.

## 2. Color

| Role | Token | Usage |
| --- | --- | --- |
| Paper | `--paper` | Light gallery surface |
| Ink | `--ink` | Primary text |
| Card surface | `--featured-card-surface` | Featured-build cards |
| Ember edge | `--pink` | Ember card ring |
| Study edge | `--blue` | Study card ring |
| Plant edge | `--featured-edge-green` | Plant card ring |
| Motion edge | `--featured-edge-amber` | Motion card ring |

The gallery uses the existing `--featured-wash-blue` and `--featured-wash-pink` values only as background light, never as card fills.

## 3. Typography

- UI font: `--font-ui`
- Featured card title: 1.08rem desktop, 1rem small screens, weight 700
- Featured card secondary text: 0.9rem desktop, 0.8rem small screens

## 4. Spacing & Layout

- Gallery rail gap: `--featured-rail-gap`
- Card copy inset: `--featured-card-copy-padding-inline`
- Card radius: `--featured-card-radius`
- Responsive rail: four columns on desktop; scroll-snapped cards on smaller screens.

## 5. Components

### Featured build card

- **Structure:** button, product image, title, supporting label, perimeter ring.
- **Default:** white card with a 2px tinted perimeter ring and no card shadow.
- **Hover:** ring becomes more saturated in place, an inset colored bezel appears, and a soft glass reflection sweeps over the media; card geometry does not move.
- **Selected:** uses the same shadow-free treatment with a stronger ring.
- **Accessibility:** native button, visible perimeter color, scroll-snap rail.

## 6. Motion & Interaction

- Ring color and glass-reflection opacity: `--featured-interaction-duration` with `ease`.
- No vertical card translation inside the horizontally scrolling rail, so the ring cannot be clipped.
- `prefers-reduced-motion` disables nonessential transitions.

## 7. Depth & Surface

The featured gallery uses **borders-only** depth: white card surfaces, tinted 2px perimeter rings, an inset hover bezel, and no outer card shadows.

## 8. Accessibility Constraints & Accepted Debt

- Preserve native button semantics and keyboard operation.
- Respect `prefers-reduced-motion`.
- Keep card images flush to the card edge without decorative padding.

## 9. Build detail commerce sheet

- **Shell:** warm `--paper` surface inside the existing dark modal scrim. The sheet uses a 2px cream outer bezel, a 1px inner highlight, and a 2rem radius. The soft glass belongs only to the fixed scrim/sheet layer, never to the scrolling content.
- **Media:** the product image is a single rounded 1.5rem frame with `object-fit: cover`; it remains the visual anchor. This build-detail surface intentionally has no gallery carousel unless a build ships multiple media assets.
- **Brand row:** the existing Makeable wordmark (`makeable-logo-tight.webp`) leads the detail header, followed by the creator badge. Do not substitute a letter mark.
- **Traits:** use fine coral line icons for ready, time, and gifting. Labels remain plain text, without pastel pill backgrounds.
- **Commerce CTA:** a restrained navy action bar appears above the parts list, with white text and a compact circular trailing arrow island. Press feedback is transform-only and respects reduced motion.
- **Part comparison row:** a warm-white, 1rem rounded row with a component-specific electronics thumbnail, a numbered role title, muted specification, coral "Why we picked this" disclosure, and two independent retailer cards.
- **Retailer cards:** Amazon and AliExpress are separate white cards. Their wordmarks are distinct, each has its own dollar price underneath, and each has a bordered one-line retailer action. Verified Amazon quotes replace the catalog fallback when available. Never render a shared price as though it applied to both retailers.
- **Footer trust note:** a small Makeable coral mark precedes the trusted-retailer notice. Price availability language remains secondary.
- **Type hierarchy:** only the build title, part role, and primary CTA use display-weight emphasis. Creator information, traits, item specifications, retailer actions, price provenance, and footer notes use the UI font at 400–600 weight. Retailer wordmarks retain their recognizable weight, but price values remain semibold rather than display-bold.
