# Integrated RescueMemory landing

The web home route renders this bundled landing through `LandingPage.jsx`. HashRouter owns application routes; section links are handled as in-page scrolling. Capacitor native entry redirects to `/chat`, including legacy landing aliases, without loading this view or Three.js.

The static template is authored source, never remote or user-provided HTML. CSS selectors are scoped to `.landing-page`; motion listeners, observers and WebGL resources are disposed on navigation. The architecture and film use sticky scenes whose progress is derived from scroll position. Diagram connectors require both endpoint boxes to be fully visible and hide first during reverse scrolling. Reduced-motion shows a complete static diagram and disables pinning. Phones get a vertical schematic and a static Earth.

Overview was replaced by the landing. Its useful workspace shortcuts, offline storage explanation, report visibility choices, source references and admin protocol publishing are retained. No live telemetry placeholders or unverified speed claims are presented. Phone-embedded Qdrant Edge remains a separate planned implementation; the current diagram places Edge on the Python response node.

## Asset credits

- Earth texture: NASA Earth Observatory, Blue Marble Next Generation, September 2004. NASA imagery by Reto Stockli; NASA Earth Observatory credit Robert Simmon. https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/
- Three.js 0.186.1 is vendored locally; MIT license in `vendor/THREE-LICENSE.txt`.
- Brand mark uses the actual RescueMemory favicon.
- Technology marks were retained from the approved prototype; sources are listed in `public/landing/assets/logos/sources.json`.
- Fonts reuse the application's bundled Manrope, Space Grotesk and DM Mono assets and licenses.
