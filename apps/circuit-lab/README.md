# Circuit Studio

This is Makeable's existing AWS GLB assembly viewer, restored from the exact deployed source on 2026-09-04. It is not a replacement renderer.

The main project's Wiring tab embeds `/circuit-studio/?mode=guide&embed=1&sourceBuildId=…`. Circuit Studio reads that exact saved project through the existing account/public build APIs, validates its manifest identity, then loads the assembly's immutable AWS GLBs and accepted wire samples. It never generates another build for this route.

The same-origin parent sends `makeable:wiring-step` with `buildId` and `stepIndex`. The viewer returns `makeable:wiring-status` with the same `buildId` and `loading`, `ready`, or `unavailable`. Both sides validate the sending window, origin, and build identity. A ready iframe is not sufficient: readiness is sent after the actual GLBs and wire geometry have loaded.

`refined.css` owns the refined presentation. `app.js` retains the original renderer and identity gates; the presentation changes are camera framing, mobile pane controls, and load/error feedback. Regression tests pin the original GLB transforms, accepted-polyline renderer, and saved-identity gate sections by SHA-256.

## Release boundary

The production Three.js r185 vendor files under `/circuit-studio/vendor/` are preserved byte-for-byte by the scoped release, as are the current backend bundles, Dashboard, and Ember. The older full-site `build:static` script in this isolated UI branch does not package Circuit Studio and must **not** be used to publish this branch as a whole site. Use a reviewed main-site/Circuit Studio overlay against the current production manifest. Do not deploy the original dirty checkout.
