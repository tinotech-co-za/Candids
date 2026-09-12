#!/bin/bash
set -euo pipefail
umask 077
runtime=/opt/tinotech-candids
state=/home/dev/.local/share/homelab/tinotech-candids
test "$(id -u)" = 0
test "$(cat "$state/INSTANCE")" = tinotech-candids
test -f "$runtime/compose.yaml"
test -d "$state/data"
mkdir -p "$state/backups"
exec 9>"$state/backup.lock"
flock -n 9 || { echo 'Candids backup is already running'; exit 1; }
# Recover interrupted archives only while holding this stack's exclusive lock.
find "$state/backups" -maxdepth 1 -type f -regextype posix-extended -regex '.*/candids-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.partial' -delete
data_kib=$(du -sk "$state/data" | cut -f1)
available_kib=$(df -Pk "$state" | tail -1 | awk '{print $4}')
test "$available_kib" -gt "$((data_kib + 524288))" || { echo 'Insufficient free backup space'; exit 1; }
cd "$runtime"
archive="$state/backups/candids-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
test ! -e "$archive"
# A stopped copy includes SQLite, local object storage, function code and secrets
# consistently. The interruption is deliberate; never archive a live SQLite tree.
restart() {
  rm -f -- "$archive.partial"
  docker compose up -d candids-convex web >/dev/null
}
trap restart EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
docker compose stop web candids-convex >/dev/null
tar -czf "$archive.partial" -C "$state" data INSTANCE -C "$runtime" compose.yaml .env secrets
gzip -t "$archive.partial"
mv "$archive.partial" "$archive"
sha256sum "$archive" >"$archive.sha256"
chmod 600 "$archive" "$archive.sha256"
# Only this service's dated archives are covered by the seven-day backup policy.
find "$state/backups" -maxdepth 1 -type f \( -name 'candids-????????T??????Z.tar.gz' -o -name 'candids-????????T??????Z.tar.gz.sha256' \) -mmin +10080 -delete
echo 'Candids stopped-state backup completed; copy it to protected off-host storage.'
