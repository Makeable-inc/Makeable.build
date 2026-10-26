# Ember landing-page override

This page overrides the generic personalization pattern in `../MASTER.md`.

## Product story

- Five-second message: **Turn Claude usage into a living desk pet.**
- Supporting proof: Claude activity charges Ember, Ember evolves, and the Mac streams the living scene to a 2.8-inch ESP32 CYD display.
- Primary action: download the current Apple-silicon macOS build.

## Visual system

- Pattern: hero-centric, editorial single-product reveal.
- Tone: premium Apple-like restraint paired with lovable indie hardware.
- Hero: coal black with one warm Ember light source; supporting content: soft cream.
- Product art: actual Ember GIFs inside a code-built hardware frame. Never replace the character with stock imagery.
- Typography: the Apple system stack, tight optical tracking for display type, comfortable body leading.
- Geometry: softly machined hardware corners and restrained 12–24px interface radii; no bento grid or card wall.

## Interaction and accessibility

- Minimum interactive target: 44×44px.
- Immediate pressed feedback; no decorative-only page choreography.
- Use real GIF movement for the product demonstration and static PNG equivalents when `prefers-reduced-motion` is enabled.
- Maintain visible keyboard focus, sequential headings, descriptive alt text, and WCAG AA contrast.

## Performance

- Load only the hero animation eagerly. Defer supporting GIFs and reserve their 4:3 aspect ratios to prevent layout shift.
- Keep the 191 MB DMG outside the Netlify site deploy. `/ember/download` redirects to the versioned GitHub Release asset.
