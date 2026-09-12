# Dedicated Candids on devbox

This stack deploys the official self-hosted Convex backend and a Next.js standalone
runtime. It is a new isolated backend; it must never use a legacy cloud credential,
volume, database or capability receipt. The public synthetic demo still works
with `CANDIDS_PILOT_ENABLED=false`.

Only Next port 4211 is published to the LAN, behind the reviewed homelab proxy at
`https://candids-pilot.tinomuzambi.com`. The host firewall must restrict that port
to the proxy. Convex's API binds only host loopback 3210 for SSH deployment, and
HTTP actions on 3211 are Docker-network-only. There is no dashboard container.
The backend has no public route. Its private unshared bridge permits outbound
requests; current album functions do not call external services.

Resource limits: Next 768 MiB/1 CPU/256 PIDs; Convex 2 GiB/1.5 CPUs/256 PIDs;
three 10 MiB log files per service. Data lives outside the runtime directory at
`/home/dev/.local/share/homelab/tinotech-candids/data`. Start with at most five
managed events and review free disk before provisioning; individual album limits
do not imply an unlimited aggregate service quota.

The backend is pinned to the reviewed linux/amd64 manifest
`sha256:6963145df5eca4265f4cf9eda4c494e35a049121405a50f4ff90e6310834986a`.
The Node base image is pinned in `Dockerfile`. Build on Agentbox and transfer
only the two final runtime images; do not build or retain dependency caches on
devbox. Record `docker image inspect --format '{{.Id}}' IMAGE` before transfer
and verify the same identity after loading. `.env` beside the Compose file must
contain `CANDIDS_IMAGE=sha256:REVIEWED_FINAL_IMAGE_ID`; `pull_policy: never` prevents
an accidental moving-tag pull. The build context excludes private env files,
provider state, Git history and generated output.

## Private installation and deployment

Keep runtime files in `/opt/tinotech-candids`, with root-only `secrets/` containing
`backend.env` (`INSTANCE_NAME` and random 64-hex `INSTANCE_SECRET`), `web.env`
(`CANDIDS_PILOT_ENABLED=false`, the exact HTTPS `CANDIDS_APP_URL`, and distinct
random bridge/cookie secrets), and the protected operator record. Use mode 0600
for credentials and mode 0700 for their directory. Never print Compose's fully
rendered configuration or unrestricted Docker inspect output after configuration.
Create the state directory with an `INSTANCE` file containing `tinotech-candids`.
The official backend executable is root-owned mode 0744. Keep its required UID 0
with every Linux capability dropped, and make its data directory root-owned mode
0700; a dev-owned mode 0700 directory is inaccessible after capabilities are
dropped. Next remains non-root. No privileged container or host Docker socket is
mounted.

Review source, tests, final image IDs and Compose before starting the new stack.
Then start only the backend, and capture `docker compose exec -T candids-convex
./generate_admin_key.sh` directly to private operator storage. Keep that admin key
out of the Next container. Deploy functions from the durable checkout using the
official Convex CLI and a private env file containing only
`CONVEX_SELF_HOSTED_URL=http://127.0.0.1:43210` and the corresponding
`CONVEX_SELF_HOSTED_ADMIN_KEY`. Open an SSH tunnel from Agentbox local 43210 to
devbox loopback 3210. Use `--env-file /private/operator.env` for every Convex
operation so another checkout's cloud selection cannot be inherited.

Set `CANDIDS_BRIDGE_SECRET` in Convex to the exact new web bridge value. Keep
`CANDIDS_STORAGE_MAINTENANCE_ENABLED=false` except during reviewed synthetic or
operator maintenance. `CONVEX_CLOUD_URL` is now `http://candids-convex:3210`;
pass that exact identity to the existing internal maintenance tools. Never expose
it or storage/admin URLs in product pages or capabilities.

After source review, start the Next container with the pilot disabled and check
the public demo and API 503 guard through HTTPS. Enable only the isolated pilot
for synthetic acceptance. Provision with:

```sh
CANDIDS_SELF_HOSTED_ENV=/private/operator.env node scripts/provision.mjs --self-hosted /private/synthetic-input.json /private/synthetic-card.json
```

The input uses `synthetic:true`, a name beginning `Synthetic `, and the exact
HTTPS app origin. Hosted browser acceptance requires
`CANDIDS_TEST_ALLOW_HOSTED_SYNTHETIC=true`, the same exact origin as
`CANDIDS_TEST_URL`, and that generated `CANDIDS_TEST_CARD`. Acceptance checks
host/guest consent and uploads, unshared/shared files, ZIP, recovery, old-host
revocation and blocking. Also check closed uploads, expiry/cleanup, storage
reconciliation, and restore a backup into a separate isolated backend before
accepting a paid event. Real WebKit engine file selection and the full lifecycle have passed public HTTPS acceptance. Physical iPhone/iPad Safari testing remains separate; do not describe engine coverage as physical-device testing.

## Backups and recovery

`backup.sh` takes an exclusive lock, checks space, stops only these two containers,
archives the entire backend data tree plus instance/app/operator credentials,
verifies gzip and writes a SHA-256 checksum, then restarts the same stack. The
daily timer causes a short planned service interruption. Install/enable it only
after a successful manual backup and independent restore. Data archives are
private and contain photos and access credentials; never commit or publish them.

Backups are retained locally for seven days. Install `copy-backup-offhost.py` in
Agentbox's `~/.local/share/tinotech-candids/ops/`, and its off-host service/timer in
`~/.config/systemd/user/`. Run the service once, verify success, then enable its
timer under the lingering `agent` user. It copies the latest dedicated devbox
archive at 04:00 UTC, checks freshness, capacity, gzip and SHA256, and keeps protected
Agentbox copies in `~/.local/share/tinotech-candids/backups` for seven days. Its
only SSH target is `devbox`, with fixed dedicated archive paths and validated
dated filenames. It fails on stale backups, mismatched existing files and an
archive over 2 GiB rather than silently accepting an incomplete recovery point.
After an interrupted process, its exclusive copy lock protects cleanup of only
its dated regular partial files; completed archives are never overwritten.
Check both backup units for failures before opening a managed event; the timers
do not send external alerts on their own.
Live album expiry is independent of backups; agree the additional backup retention
in written event terms. Never describe live deletion as immediate removal from
backups. Alert on failed backups, failing health, stale cleanup and less than
2 GiB free disk before opening another event.

For recovery, verify checksum and archive filenames, extract into a **new** private
directory, and start a separate backend container from the exact recorded image
with that restored data and instance identity. Publish only a distinct loopback
test port. Verify restored function/version health, album metadata and a synthetic
photo's bytes through authenticated functions. Do not overwrite the running data
tree or expose the restored backend. Upgrades require this backup/restore check
and a reviewed new digest; do not run a blanket Docker prune.

References: [official self-hosting](https://docs.convex.dev/self-hosting),
[Docker deployment guide](https://github.com/get-convex/convex-backend/tree/main/self-hosted),
and [upgrade/export guidance](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/upgrading.md).


## Managed readiness and automatic status

The backend enforces the aggregate five-event cap atomically for every provision
path. Real synthetic acceptance exercised 60 concurrent guest attempts (50
admitted), 100 simultaneous bounded photo reservations (200 MB total), duplicate
requests, cancellations and the 20-photo guest quota. Chromium and WebKit each
exported 100 valid 2 MB JPEG files through the public app, with all ZIP entries,
manifest counts and SHA256 hashes verified. The large fixture uses valid JPEG
metadata padding; physical mobile device memory, camera capture and HEIC behavior
are not implied by desktop engine tests.

Install `health-probe.py` as root-owned `/opt/tinotech-candids/health-probe.py` and
`health-monitor.py` under Agentbox's protected `~/.local/share/tinotech-candids/ops`.
Install the health service/timer in `~/.config/systemd/user/`, run the service once
and enable the timer. Every five minutes it checks public HTTPS/demo and the
unauthenticated private API guard, the two container health states, free disk,
the five-event limit, cleanup freshness/overdue expiry, backup timers/service
results and local/off-host backup freshness. The off-host checksum is rechecked.
Each run has CPU/memory/time bounds and atomically updates the private
`~/.local/share/tinotech-candids/status/health.json`; failed reads preserve the last
successful timestamp and mark the current status failed. No album names, buyer
addresses, capabilities or credentials are emitted. No external message is sent.

Inspect `systemctl --user status tinotech-candids-health.service` and the private
status file before activation. `ok:true` older than ten minutes is stale; check
Agentbox/timer availability. Failed backup, cleanup older than 70 minutes, an
expired album overdue 45 minutes, unhealthy containers or less than 2 GiB free
space blocks new managed onboarding until reviewed. A planned backup interruption
can briefly fail a probe; the next run must recover. Health probes do not mutate
customer data or automatically restart unrelated services. On backup tar failure
or TERM, the backup trap removes its partial archive and restarts this stack.
After an abrupt kill/reboot, the next locked backup removes only its dated regular
partial files; the failed service is visible to the health monitor. Inspect and
restart only this stack if the host interrupted its restart trap.

For accepted payment binding, durable provisioning, private delivery drafts and
later refund/dispute handling, follow [PAID-ONBOARDING.md](PAID-ONBOARDING.md).
