# Candids Netlify preparation

This branch adds hosting configuration to the managed-event branch. It does not deploy Convex, migrate legacy data, enable events, or move DNS. The public demo can build without a backend.

Use Node24 and the committed npm lockfile. `npm test` passed16 tests; the offline Netlify build passed with official Next adapter5.15.13 and packaged the server handler. This proves packaging, not hosted private-event or large-archive acceptance.

For a future draft, use the full Netlify build-and-deploy path. Do not upload raw `.next` with a separate `--no-build` invocation: it can expose server files and omit browser assets. An intentionally split deployment must validate and explicitly upload only the adapter's `.netlify/static` directory. Check browser assets and private-source denials before sharing a preview.

Keep `CANDIDS_PILOT_ENABLED=false` until the dedicated cloud Convex project and hosted private acceptance are complete. Preserve the same distinct bridge and cookie secrets for any existing accepted event; do not invent a legacy migration. Required server configuration is `CANDIDS_CONVEX_URL`, `CANDIDS_BRIDGE_SECRET`, `CANDIDS_COOKIE_SECRET`, exact `CANDIDS_APP_URL`, and reviewed `CANDIDS_ASSET_URL` if a separate social-asset origin is temporarily needed. `CANDIDS_ALLOW_LOCAL` must not enable a production bypass.

The existing README's private host/guest, recovery, quota, retention, backup, orphan-file and actual-device upload gates still apply. Validate the entire allowed collection export against hosting response limits before any paid event; a successful small sample ZIP is insufficient. No accounts, secrets, sites, databases, deployments or DNS records were changed during this preparation.

The exact review branch `codex/candids-netlify-free` disables Vercel Git deployment in source configuration. Other branches keep their behavior. This avoids deploying through the unresolved legacy Vercel integration merely to publish a reviewable migration branch. The PR stacks on the managed-event branch; neither it nor that parent is authorized as a backend migration.
