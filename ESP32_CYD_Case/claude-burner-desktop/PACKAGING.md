# Claude Burner 1.1.1 prototype packaging

The arm64-only macOS prototype is built with:

```sh
npm run dist:mac
```

`prepack` intentionally validates the already-produced version 2 animation
catalog instead of rebuilding animation source material. Packaging will stop
unless all 15 active GIFs, their 15 static anchors, and the catalog declarations
for the firmware-resident `no_connection` fallback and firmware-rendered
`waiting_for_claude` state are present and valid.

The application bundle includes only the production runtime catalog, the 15
shared exact-12-FPS desktop/device GIFs, 15 static scene anchors, UI/runtime code,
and the Claude status-line bridge. The actual system fallback drawing code
remains in firmware. Development frame folders, raw RGB565 archives, preview
duplicates, animation audits, alternate frame-rate libraries, and unused system
posters remain in the workspace and are excluded from the DMG.

This prototype sets `identity: null`, so it is not Developer ID signed or
notarized. The packaging script copies the finished bundle outside any macOS
File Provider directory, removes attached filesystem metadata, and applies a
coherent local ad-hoc seal. Strict `codesign` verification must pass before the
DMG is accepted. The ad-hoc seal prevents a malformed resource envelope, but it
does not establish developer trust: first launch still requires the documented
Control-click / Privacy & Security confirmation.

This is suitable for local prototype installation, but it is not ready for
frictionless public distribution. A public release needs a Developer ID
Application certificate, hardened-runtime signing for the main app and nested
helpers, notarization, stapling, and a final Gatekeeper assessment.
