# RescueMemory web interface

Palak's React/Vite interface is integrated with the local RescueMemory API. Build it with `npm ci` and `npm run build`; the FastAPI node serves `dist/` on the same port. The root [README](../README.md) covers full setup and the three-node demo.

The survivor Ask view retrieves local Qdrant Edge memory and can optionally request a Gemini summary through the backend. It never embeds the Gemini key in browser code. A question suggesting that someone needs rescue opens a prefilled SOS for review; it does not save or share the report automatically. The nearby map reads the local API every 30 seconds. The header toggle stores the light/dark preference in this browser.
