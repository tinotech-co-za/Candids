# Acceptance evidence

Captured 12 September 2026. All artwork, event names and guest names are fictional. These screenshots contain no actual customer event, account key, invitation URL or private operator receipt.

- [Desktop landing](landing-desktop.png)
- [Desktop album/host controls](album-desktop.png)
- [Mobile landing](landing-mobile.png)
- [Mobile guest album](album-mobile-guest.png)
- [Machine-readable acceptance](acceptance.json)

`node scripts/acceptance.mjs` reproduces sample interaction and screenshot checks. The private `CANDIDS_TEST_CARD` option additionally exercises an isolated local Convex event. The backend tests cover cross-event authorization, own-photo rules, file visibility/revocation, host recovery, failed-access limiting, fifty guests on one venue IP, quotas, idempotency and expiry cleanup. Image tests reject non-images/oversize bodies and verify dimensions/metadata stripping. The current Convex test double omits Blob contentType metadata; the real local HTTP acceptance covers storage finalization instead of weakening the production MIME check.

The public deployment has real-event APIs disabled. These results are not a claim that an unconfigured cloud backend or actual-device Safari upload has been tested. See the main README for the remaining hosted acceptance and operator retention checks.
