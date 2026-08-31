# Makeable Private Dashboard Design System

## 1. Atmosphere & Identity

The dashboard is a quiet operating room for Makeable's growth work. It is dark,
compact, and calm enough to scan daily without feeling like a trading terminal.
Its signature is a single electric-blue line that carries selection, focus, and
data emphasis through otherwise neutral graphite surfaces. This document
codifies the existing dashboard rather than introducing a new visual language.

Design read: private operational dashboard for founders. Preserve mode.

- Design variance: 4
- Motion intensity: 3
- Visual density: 7
- Spatial reference: StyleGallery `sticky-header`; the document is the only
  vertical scroll owner and the top bar stays visible.

## 2. Color

### Palette

| Role | Token | Value | Usage |
|---|---|---:|---|
| Background | `--background` | `#07090e` | Page canvas |
| Background/deep | `--background-deep` | `#05070b` | Top gradient anchor |
| Surface | `--surface` | `#0a0e15` | Panels and controls |
| Surface/strong | `--surface-strong` | `#0d121b` | Table headers and menus |
| Surface/hover | `--surface-hover` | `#101722` | Hover and selected neutral states |
| Border/default | `--border` | `#202a39` | Panels and inputs |
| Border/subtle | `--border-soft` | `#17202d` | Dividers |
| Text/primary | `--text` | `#f5f7fb` | Primary copy and values |
| Text/secondary | `--text-soft` | `#a2abba` | Labels and secondary copy |
| Text/tertiary | `--text-faint` | `#748094` | Captions and inactive content |
| Accent/primary | `--accent` | `#3388ff` | Selection, focus, charts |
| Accent/bright | `--accent-bright` | `#60a5fa` | Focus and highlighted values |
| Accent/deep | `--accent-deep` | `#1f6feb` | Pressed and filled states |
| Status/success | `--success` | `#45c98b` | Successful imports and positive change |
| Status/warning | `--warning` | `#d99b37` | Partial or stale data |
| Status/error | `--danger` | `#fb7185` | Errors and destructive feedback |

### Rules

- The dashboard stays dark. It does not switch section themes.
- Blue is the only interactive accent. Status colors communicate real state.
- New colors must be added here before entering CSS.

## 3. Typography

### Scale

| Level | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| Page title | `27px` | 620 | 1.2 | Authentication title |
| Metric | `clamp(28px, 3.1vw, 41px)` | 530 | 1 | Primary totals |
| Section title | `18px` | 610 | 1.3 | View headings |
| Panel title | `15px` | 590 | 1.4 | Panels and tables |
| Body | `14px` | 400 | 1.6 | Forms and explanations |
| UI label | `13px` | 560 | 1.4 | Buttons and controls |
| Data | `12px` | 400 | 1.5 | Tables and card metrics |
| Caption | `11px` | 500 | 1.4 | Metadata and helper text |

### Font Stack

- Primary: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Numeric data uses tabular numerals from the primary stack.

### Rules

- Existing Inter usage is retained because this is preservation work.
- Visible body copy does not fall below 12px. Eleven-pixel text is metadata only.
- Long captions clamp or wrap; primary labels never disappear through clipping.

## 4. Spacing & Layout

### Base Unit

Spacing intent derives from a 4px base.

| Token | Value | Usage |
|---|---:|---|
| `--space-1` | `4px` | Tight icon alignment |
| `--space-2` | `8px` | Compact clusters |
| `--space-3` | `12px` | Control padding |
| `--space-4` | `16px` | Panel rhythm |
| `--space-5` | `20px` | Panel padding |
| `--space-6` | `24px` | Page groups |
| `--space-8` | `32px` | Major separation |

### Grid and shell

- Maximum content width: 1600px.
- Page gutters: `clamp(18px, 2vw, 32px)`, reduced to 12px below 620px.
- Breakpoints: 620px compact, 850px toolbar compression, 1100px metric reflow.
- The document owns vertical scrolling. The 66px top bar uses the
  StyleGallery `sticky-header` pattern.
- Metric and content grids use overflow-safe intrinsic tracks:
  `minmax(min(16rem, 100%), 1fr)`.
- At 375px, primary content is one readable column with no page-level
  horizontal scroll. Data tables may own horizontal scroll inside their panel.

## 5. Components

### Section selector

- **Structure**: visible label, native `select`, decorative chevron.
- **Variants**: Overview, Social, Waitlist.
- **States**: default, hover, focus, disabled.
- **Accessibility**: native keyboard behavior; persistent label for screen readers.
- **Motion**: color and border feedback only; no decorative movement.
- **Layout**: compact cluster inside the sticky top bar.

### Button and icon button

- **Structure**: native button, optional icon, label.
- **Variants**: primary, secondary, icon-only.
- **States**: default, hover, active, focus, disabled, busy.
- **Accessibility**: visible focus ring and accessible name for icon-only buttons.
- **Motion**: 1px active press and 160ms color/transform feedback.

### Metric rail

- **Structure**: label, tabular value, one-line explanation.
- **Variants**: standard and featured.
- **Social metrics**: Content exposures, Engagement rate, Website conversions,
  Website visit rate, Followers gained, Published posts. Website attribution
  renders `Not connected` when disconnected and `Unavailable` when its query
  fails; connected zeroes remain visible as `0` or `0.0%`.
- **Owner metric totals**: platform clicks and follower gains sum only accounts
  whose owner APIs measured the field. Individual unknown accounts remain an em
  dash; one unknown account never discards real measurements from other accounts.
- **States**: loading placeholder, populated, connected zero, not connected,
  unavailable.
- **Accessibility**: values remain text and preserve semantic reading order.
- **Layout**: six columns wide, three medium, two compact.

### Panel

- **Structure**: heading cluster, controls, body, optional footer.
- **Variants**: chart, table, content gallery, empty state.
- **States**: loading, populated, empty, error.
- **Accessibility**: every panel is labelled by its heading.
- **Layout**: stack; internal table or media reel may own horizontal scrolling.

### Account ranking table

- **Structure**: rank; account identity with a visible coverage badge; platform;
  content exposures; engagement rate; platform link clicks; website
  conversions; website visit rate; followers gained; posts.
- **Coverage badge variants**: Connected, Platform only, Public snapshot,
  Attribution only, Unavailable. The badge reports which measurement sources
  support each row and never implies partial engagement is measured.
- **Metric truth**: per-account unknown values render an em dash. Connected
  zeroes render as `0` or `0.0%`. Partial engagement is never compared or
  synthesized; it remains an em dash. Content exposures are never labelled as
  unique reach.
- **Ranking**: sortable measures include content exposures, engagement rate,
  website conversions (`websiteSessions`), website visit rate, follower gain,
  and posts. Rank changes update the active column's `aria-sort` value.
- **States**: loading, populated, empty, not connected, unavailable.
- **Accessibility**: a semantic table uses scoped headers and exposes
  `aria-sort` on the sorted column. Its named, keyboard-focusable region owns
  horizontal scrolling; the page never owns horizontal overflow.
- **Layout**: the table keeps intrinsic column width inside its panel. At 375px
  and 200% zoom the document remains the only vertical scroll owner while the
  named table region may scroll horizontally.

### Social attribution status

- **Structure**: a short label paired with the website-attribution value.
- **Variants**: connected metrics, Not connected, Unavailable.
- **Overview rule**: the Social pulse uses Content exposures, then shows
  Website conversions and Website visit rate only when attribution is
  connected. Otherwise it shows Website attribution with the truthful status.
- **Accessibility**: status is visible text, not color alone, and follows the
  content-exposure metric in reading order.

### Social performance chart

- **Structure**: blue content-exposure bars, a green measured engagement-rate
  line, explicit left-axis name `Content exposures`, explicit right-axis name
  `Engagement rate`, date labels, and a persistent SVG description.
- **Metric truth**: an unknown or partial engagement-rate day breaks the green
  line. Separate measured runs render as separate path segments so the chart
  never implies continuity through an unmeasured day.
- **Accessibility**: the rendered SVG retains the description referenced by
  `aria-labelledby`; the description names both measures and both axes. Axis
  names are exposed as text in the SVG rather than inferred from numeric ticks.
- **Color**: the engagement-rate line, dots, and legend swatch use the existing
  `--success` percentage/status token. Content exposures use `--accent`.

### Social content card

- **Structure**: 16:9 media frame, play control, platform/account metadata,
  caption, and compact performance row.
- **Variants**: playable video, thumbnail-only, media unavailable.
- **States**: default, hover, focus, loading image, unavailable media.
- **Accessibility**: play button names the content and never relies on the
  thumbnail alone; decorative overlays are hidden from screen readers.
- **Motion**: image scale is forbidden; only the real play control receives
  hover and press feedback.
- **Layout**: intrinsic grid that collapses to one column below 620px.

### Media viewer

- **Structure**: native `dialog`, heading, close control, media frame, caption,
  and post metrics.
- **States**: closed, opening, playing, paused, playback unavailable, opening
  failed, closing. Playback failure hides and stops the failed video, reveals a
  clear unavailable message, and resets before the next media item opens.
- **Accessibility**: focus is trapped by native dialog behavior, Escape closes,
  focus returns to the invoking play button, and the unavailable message uses a
  polite atomic status announcement. Background scrolling is locked only while
  the dialog is open.
- **Motion**: 180ms opacity and transform entrance; reduced motion is instant.
- **Layout**: centered imposter with a bounded 16:9 frame. The frame uses
  zero-minimum grid tracks and clips overflow so portrait media cannot enlarge
  the frame; the video or image remains fully contained with `object-fit:
  contain`, and the caption/metrics begin below the frame without overlap. The
  explicit `is-media-viewer-open` state applies to the document root and body,
  preserves the current page offset, compensates for the removed scrollbar to
  prevent layout shift, and restores prior inline styles and scroll position on
  native close or opening failure. The dialog retains its own vertical scrolling.

### Import control

- **Structure**: labelled file input invoked by a button, template link, inline
  status text.
- **States**: idle, reading, uploading, success, error.
- **Accessibility**: accepts keyboard activation and announces status changes.

## 6. Motion & Interaction

| Token | Duration | Easing | Usage |
|---|---:|---|---|
| Micro | 130-160ms | ease-out | Hover, focus, press |
| Standard | 180-240ms | cubic-bezier(0.16, 1, 0.3, 1) | Dialog enter and view change |

- Motion communicates selection, loading, opening, or closing only.
- The section selector stays native; browser interaction behavior is retained.
- The media viewer follows the beui.dev center-morph-modal mechanism at a
  restrained intensity: backdrop fade, centered scale, focus return, body lock.
- Only `transform`, `opacity`, and `filter` animate.
- `prefers-reduced-motion: reduce` removes transform-based motion.

## 7. Depth & Surface

Strategy: mixed tonal shift and borders.

- Page and panel depth comes from progressively lighter graphite surfaces.
- Panels use a 1px default border and subtle inset highlight.
- Menus and dialogs may use one tinted shadow to show true elevation.
- Cards inside a panel avoid an additional shadow unless they are interactive.
- Radius system: 14px panels, 8-10px controls, full circles only for avatars and
  icon buttons.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- WCAG 2.2 AA target: 4.5:1 body contrast and 3:1 large-text contrast.
- Every interaction must work with keyboard only.
- Focus is always visible and never indicated by color alone.
- Media never autoplays. Playback begins after an explicit click.
- Video controls remain native and captions may be supplied by the imported
  media source when available.
- Reduced motion is respected for every transition.
- Empty, loading, error, and media-unavailable states are visible and announced.

### Accepted Debt

No accessibility debt is accepted for this feature.
