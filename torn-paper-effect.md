# Torn-paper grain effect - portable snippet

The frayed "torn paper" grain used on cards and seams (e.g. the footer
separator). Two pieces are required: (1) the SVG filter definitions, and
(2) CSS that applies the filter to a background-only layer.

> ⚠️ The filter frays *edges*, so only apply it to background layers
> (strips, backing panels, `::before`/`::after` pseudo-elements) - never
> directly to elements containing text, or the text warps.

---

## 1. SVG filter definitions

Paste this once near the top of the page's `<body>`. It renders nothing
visible (width/height 0); it just registers the reusable filters.

```html
<!--
  Reusable torn-paper edge filters. Applied via CSS `filter: url(...)`
  to background-only layers so rectangular edges fray into fibrous torn
  paper without warping text.
-->
<svg class="paper-filters" width="0" height="0" aria-hidden="true" focusable="false">
  <defs>
    <filter id="torn-paper" x="-6%" y="-12%" width="112%" height="124%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.012 0.06"
        numOctaves="4"
        seed="21"
        result="tornNoise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="tornNoise"
        scale="7"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>

    <filter id="torn-paper-fine" x="-10%" y="-14%" width="120%" height="128%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.028 0.09"
        numOctaves="3"
        seed="8"
        result="tornNoiseFine"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="tornNoiseFine"
        scale="4.5"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </defs>
</svg>
```

- `#torn-paper` - coarser fray (bigger, more dramatic tears).
- `#torn-paper-fine` - finer fray. This is the one used almost everywhere,
  including cards and seams.

---

## 2. CSS usage

Reference the filter by id with `filter: url("#torn-paper-fine")`. A
`drop-shadow(...)` in the same `filter` chain lifts the torn layer off the
page. Tune `scale` on the SVG filter for more/less fraying.

### Seam / separator strip (as used above the footer)

```css
/* Torn white grainy separator strip. */
.torn-separator::before {
  content: "";
  position: absolute;
  z-index: 1;
  top: -0.25rem;
  right: -0.375rem;   /* slight bleed past the edges so the fray reads */
  left: -0.375rem;
  height: 1rem;
  background-color: #fffefb;
  filter: url("#torn-paper-fine") drop-shadow(0 0.125rem 0.09375rem rgb(57 42 29 / 14%));
  pointer-events: none;
}
```

### Vertical seam (between two columns)

```css
.torn-seam {
  filter: url("#torn-paper-fine") drop-shadow(0.125rem 0 0.09375rem rgb(57 42 29 / 14%));
}
```

### Card / panel backing

```css
/* Grainy torn-paper backing frame behind a card. */
.torn-card {
  filter: url("#torn-paper-fine") drop-shadow(0 0.1875rem 0.4375rem rgb(59 42 28 / 13%));
}
```

---

## Notes for porting

- **The `url("#id")` reference is document-scoped.** The `<svg>` defs must
  live in the same HTML document as the elements using the filter. (In a
  bundled/SPA setup, drop the SVG into your root layout / `index.html`.)
- Keep the filter's `x/y/width/height` region larger than 100% (as above)
  so the displaced pixels aren't clipped at the edge.
- Safari renders `feDisplacementMap` fine but can be slower; keep filtered
  layers small (thin strips, backing panels) rather than full-page.
- Color the layer with `background-color` (or a `background` texture); the
  filter only reshapes the edges - it doesn't add color.
