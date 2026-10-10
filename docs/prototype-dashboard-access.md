# Prototype dashboard access

The prototype opens the volunteer, HQ and inspector dashboards without operator credentials or node-role setup. The Node Configuration modal and its header/menu buttons have been removed. Cloud addresses, phone identity, Bluetooth encryption and report validation remain managed by the existing application code.

`Settings.from_env()` enables `PROTOTYPE_ACCESS` by default. In this mode, dashboard administration and responder reads do not require keys, and verified reports/protocols can be published from any node role. The backend supplies the existing prototype guide trust key if one is not configured, and generates actual authority tags on server publications. `/health` exposes `prototype_access`.

Without a server, HQ saves entered points to the real local report inventory, with operator confirmation recorded as `prototype_confirmed`. It does not invent a server signature. The dashboard includes these points even while the server inventory has not caught up. Bluetooth carries the confirmation marker while keeping its original report verification policy. The outbox includes verification intent when publishing to the backend.

Protocols created offline are versioned drafts with `pending_publication`. The outbox retries publication; only an actual server response with an authority tag clears that flag. Success messages distinguish local saves from cloud publication. Real coordinates and valid descriptions are still required.

Restricted backend deployments can explicitly set `PROTOTYPE_ACCESS=false`. A restricted frontend build can set `VITE_PROTOTYPE_ACCESS=false`. The default demo needs neither setting nor key entry.

Validation covers all three backend node roles with no request keys, server authority tags and guide revisions, responder feeds, reset access, restricted-mode behavior, offline persistence, queued guide publication, real zero coordinates, invalid input, the old backend role rejection, and pending points in the dashboard feed. A browser demo confirms that an entered local test shelter survives page reload and increments the facility count.
