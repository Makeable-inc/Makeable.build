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
