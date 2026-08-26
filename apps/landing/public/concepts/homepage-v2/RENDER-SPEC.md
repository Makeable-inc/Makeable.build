# Makeable product-render contract

These files are the canonical wide masters for Ember, Study Desk Companion, Plant Companion, and Motion Light. The `.webp` files are the encoded production assets; the matching `.png` files are the high-resolution masters. Card crops must come from the same source image so the selected card and hero never depict different hardware.

## Shared prompt contract

Create one believable, commercially photographed desktop electronics product. Begin from the verified component geometry and solve the enclosure in millimetres before describing its appearance. Use only the selected, dimension-verified display, control, sensor aperture, USB-C opening, and ventilation. Size the display window to its verified active area, retain cable and antenna keepouts, and make the display proportionate to the enclosure rather than a tiny decorative screen.

The enclosure must be feasible for consumer FDM printing with a 0.4 mm nozzle: 2.0-2.4 mm opaque walls, practical two-part split line, locating lugs, tapered cantilever snap clips, root fillets, about 0.5 mm moving clearance, printable port and sensor openings, and an orientation that does not load clips across weak Z layers. Use restrained matte PLA/PETG surfaces with subtle real layer evidence, generous fillets, stable feet, clean shut lines, and honest component contact shadows. A translucent FDM diffuser is allowed only when the selected light output requires it; it must read as printed plastic, never glass.

Photograph the single finished enclosure in a calm, real maker or home environment. Use crisp commercial product lighting, a natural 35-50 mm camera perspective, realistic depth of field, controlled warm/cool contrast, accurate contact shadows, clean edges, and a quiet composition with room for landing-page copy. No over-sharpening, grain, noise, halation, fake labels, or invented brand text.

## Strict negative block

No transparent dome, glass cloche, acrylic bubble, animal, literal cat, figurine, mascot sculpture, decorative topper, unsupported port, unsupported sensor, imaginary board, floating circuit, exposed breadboard, loose wire, exploded view, impossible undercut, paper-thin wall, non-printable lattice, warped geometry, duplicated control, malformed screen, illegible text, fake logo, neon sci-fi styling, muddy edge, plastic-smear texture, film grain, AI noise, excessive bloom, or extra product subject.

## Crop and encoding checks

- Inspect each PNG at 100% for grain, softness, fake text, warped geometry, unsupported affordances, and crop damage.
- Derive the WebP from the accepted master without generative outpainting.
- Keep the primary enclosure, screen/control, and supporting surface intact in both desktop cover and mobile/card crops.
- Treat these as dimension-constrained product concepts, not downloadable manufacturing CAD.
