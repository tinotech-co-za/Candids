# Candids · managed event albums

Candids collects photos from one small gathering into a private, host-managed album. The public fictional sample works without a backend. A paid event is provisioned manually after a written [Tinotech event quote](https://www.tinotech.co.za/events); there is no automatic payment, subscription, email delivery or self-service event creation in this repository.

## What this pilot supports

- One host, a separate recovery key, up to 50 anonymous guest devices, 100 photos / 200 MB per event, 20 current photos per guest device and 200 lifetime upload attempts. Retention is explicitly agreed, at most 30 days from provisioning.
- Invitation links contain random 256-bit capabilities in URL fragments, removed after opening the access form. The server stores only hashes. A guest explicitly accepts photo-sharing terms before joining. An admitted browser gets a signed HttpOnly, SameSite=Strict cookie; one album per browser at a time.
- Guests initially see their own contributions. The host can share/unshare the collection, close uploads, rotate the invite, block a guest device, remove photos and download a ZIP with a caption manifest. Blocking rotates the invite so the blocked guest cannot rejoin with the same link. Names are display names, not verified identities.
- Host recovery rotates both host and recovery keys. Old host cookies lose access immediately because every read and write checks the current database hash. The new private recovery card includes replacement links. Keep it in a password manager; never paste keys into support email or tickets.
- Photos are re-encoded server-side as JPEG at a maximum of 2000 pixels on the longest edge. Embedded EXIF/location metadata is removed. The browser accepts JPEG/PNG/WebP up to 10 MB and 24 megapixels, then prepares a maximum 2 MB upload. HEIC and animated images are outside this pilot.
- Every file request goes through the Next server and an authorized Convex HTTP action. Photo and JSON responses expose no public storage URL, storage ID or bridge secret. The signed session contains an actor hash in an HttpOnly cookie. A downloaded copy cannot be revoked.

This is a managed pilot foundation, not an unattended SaaS. A guest link is a bearer invitation: distribute it privately. There is no face recognition, content moderation service, end-to-end encryption, automatic billing, background email, offline upload queue or guaranteed full-resolution camera backup. The host is responsible for consent and reviewing contributions. A large ZIP is best downloaded on desktop.

## Run and validate

Use Node 24 and npm (the committed package-lock.json is authoritative).

```sh
npm ci
npm test
npm run type-check
npm run lint
npm run build
npm run dev
```

`/demo` uses six original illustrations generated from this repository's own vector artwork, with fictional event/name labels. `scripts/generate-demo.mjs` regenerates the JPEG assets and 1200×630 PNG social image. Demo uploads are held only as browser object URLs; refresh resets the tab. No images depict actual customers. No third-party stock-photo license or remote image service is required.

For browser QA:

```sh
npx playwright install chromium
CANDIDS_TEST_URL=http://127.0.0.1:3000 node scripts/acceptance.mjs
```

The script checks desktop/mobile overflow, host/guest views, sharing, photo lightbox, sample upload, ZIP contents, JavaScript errors and writes screenshots plus an acceptance JSON report to a private temporary directory. For real local acceptance, also set `CANDIDS_TEST_CARD=/absolute/private/synthetic-card.json`. It refuses a non-loopback origin for that mode. Use only synthetic images in an isolated local deployment. Tests never select or read a production database.

## Backend setup and first paid event

The dedicated self-hosted alternative is documented in [devbox deployment](deploy/devbox/README.md).
It uses the official Convex backend container, private Docker networking, a
standalone Next runtime, and independent instance/bridge/cookie secrets. Its
isolated HTTPS synthetic acceptance and backup restoration must pass before any
paid event. The cloud instructions below remain available; a development backend
must never be exposed as the production service.

1. Create a **new isolated Convex project**, not the old photo-trading deployment. Official [anonymous agent mode](https://docs.convex.dev/cli/agent-mode) provisions a local backend without login; it does not provision a publicly hosted backend. For production, authenticate the Convex CLI with the intended account and select the new project, or supply its scoped deployment key privately. A [local backend](https://docs.convex.dev/cli/local-deployments) is for development and must not be exposed as production.
2. Deploy these Convex functions to the new project. Set `CANDIDS_BRIDGE_SECRET` in that deployment using `npx convex env set ... --from-file /private/backend.env`; use `--prod` deliberately for production. Keep the private env file outside Git. The same bridge secret goes into Vercel, alongside a distinct `CANDIDS_COOKIE_SECRET`.
3. Configure the Vercel project with `CANDIDS_CONVEX_URL=https://YOUR-DEPLOYMENT.convex.cloud`, the two server secrets, the exact HTTPS `CANDIDS_APP_URL`, and initially `CANDIDS_PILOT_ENABLED=false`. Do not expose keys through NEXT_PUBLIC variables. Preview and production must use separate secrets and backends.
4. On a restricted staging release, enable the pilot and run a synthetic acceptance event: host entry, separate guest entry and consent, both uploads, denied unshared file download, shared file download, host ZIP, recovery invalidating the old host, guest blocking, closed uploads, exact-expiry denial and scheduled cleanup. Review Convex cron failures and storage usage. Enable the public deployment only after these pass against the hosted provider. Check mobile Safari on an actual device before accepting an event; automated acceptance currently uses Chromium.
5. Agree event size, date, expiry, consent, support and price in the written Tinotech quote. Use Tinotech's existing quote/payment process and manually verify payment before provisioning. Do not claim the public demo is a paid event.
6. Prepare a private JSON input `{ "name": "Agreed event name", "eventDate": "YYYY-MM-DD", "expiresAt": "ISO timestamp", "origin": "https://candids.tinotech.co.za" }`, then run:

```sh
node scripts/provision.mjs --prod /private/event-input.json /private/event-access.json
```

The script refuses an existing output file, writes a 0600 receipt outside the checkout, and never prints keys. Deliver the host/recovery card privately to the verified quote contact. Share only the guest link with participants. Retain a protected operator receipt until the agreed expiry. If a host loses both capabilities, verify the quote contact out-of-band before an operator changes access hashes through the Convex dashboard; there is intentionally no public email-based recovery bypass. Original operator receipts do not recover a host after they rotate the recovery key.

For isolated anonymous local testing: run `npx convex dev` and keep it running, set its bridge secret without `--prod`, use its `http://127.0.0.1:3210` URL and `CANDIDS_ALLOW_LOCAL=true` in a private `.env.local`. Set `CANDIDS_PILOT_ENABLED=true` only in that local environment. Provision with `--local` and a loopback app origin. The local bypass is rejected when NODE_ENV=production.

## Retention, operations and legacy data

Access ends at the recorded expiry, independently of cleanup. A 30-minute Convex cron releases five-minute stale upload reservations, deletes up to five expired pilot albums per run (their files, members and upload records), and removes expired access-attempt buckets. Monitor cron success and the oldest expired album; more than five simultaneous expiries can take additional cycles. Rate-limit keys are HMACs of an IP address and expire after two hours, with removal on the next cleanup cycle. All photo/API responses use private no-store and no-referrer.

An upload reserves quota before storage and releases it idempotently after failure. Failed finalization now checks storage references transactionally before deleting, preserving a photo whose successful response was lost. A provider process termination between storage and database finalization can still leave an unreferenced private file. The disabled-by-default internal tools in [STORAGE_RUNBOOK.md](STORAGE_RUNBOOK.md) provide paginated metadata inventory and deletion of an exact reviewed list on the **new isolated deployment**. They reject recent files, changed fingerprints, attached photos and a mismatched deployment. No automatic storage-wide deletion is enabled. Complete the runbook's synthetic hosted acceptance before paid use; never enable maintenance in the legacy project. Provider backups and disaster recovery retention are separate from live file deletion and must match the written event terms. This repository does not promise immediate deletion from provider backups.

Before each event, verify storage quota, successful cleanup, a working host/recovery receipt and a test export. Download a host archive before expiry. If the backend is unavailable, keep uploads disabled and contact the host through the agreed support channel; no code sends notifications automatically. Rotate a leaked guest invitation in host controls; use recovery to invalidate a leaked host link. Rotate bridge/cookie secrets through Convex/Vercel if server credentials leak; cookie rotation signs everyone out. An expired event cannot be reopened using its old keys.

The old photo-trading UI and public functions were retired in this branch because they exposed unrevealed file URLs and accepted unscoped uploads. Its schema tables remain unchanged to make the boundary explicit. **This is not a migration or deployment to the old database.** No existing events, users or photos are read, moved or deleted. Previously issued public storage URLs from an old deployment are not revoked by this code. Any legacy migration requires an inventory, consent, a backup and a separate explicit plan.

## Public release status

The public release is the labelled synthetic demo and quote intake. Hosted private events remain gated pending a new cloud Convex project, hosted acceptance, provider retention/backup review, orphan-file reconciliation procedure and actual-device upload testing. Set a canonical app origin for invitations. Optional CANDIDS_ASSET_URL keeps absolute PNG Open Graph/Twitter previews on an already working public host while custom-domain DNS is pending. Contact: info@tinotech.co.za.

Public sample: https://candids-tinotech.vercel.app/demo. Intended custom domain: https://candids.tinotech.co.za (requires the recorded Vercel DNS target). Validation evidence is in [docs/qa](docs/qa/README.md).
