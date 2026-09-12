#!/usr/bin/env python3
"""Copy only the latest dedicated Candids archive from devbox to Agentbox."""
import datetime as dt
import fcntl
import gzip
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

REMOTE = "/home/dev/.local/share/homelab/tinotech-candids/backups"
DESTINATION = Path.home() / ".local/share/tinotech-candids/backups"
NAME = re.compile(r"candids-(\d{8}T\d{6}Z)\.tar\.gz")
MAX_ARCHIVE = 2 * 1024**3
MAX_EXPANDED = 4 * 1024**3


def remote(command, output=None):
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "devbox", command],
        stdout=output if output is not None else subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=600,
    )
    return None if output is not None else result.stdout.decode("utf-8")


def timestamp(name):
    match = NAME.fullmatch(name)
    if not match:
        raise ValueError("Unexpected archive filename")
    return dt.datetime.strptime(match[1], "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def collect():
    DESTINATION.mkdir(parents=True, mode=0o700, exist_ok=True)
    if DESTINATION.is_symlink() or not DESTINATION.is_dir():
        raise ValueError("Backup destination must be a private directory")
    DESTINATION.chmod(0o700)
    lock = os.open(DESTINATION / ".copy.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # A killed process cannot run its finally block. With this exclusive
        # lock, no other collector owns a partial; remove only our dated files.
        for path in DESTINATION.iterdir():
            if not path.name.endswith(".partial") or path.is_symlink() or not path.is_file():
                continue
            try:
                timestamp(path.name.removesuffix(".partial"))
            except ValueError:
                continue
            path.unlink()
        names = remote(
            f"sudo -n find {REMOTE} -maxdepth 1 -type f -name 'candids-*.tar.gz' -printf '%f\\n'"
        ).splitlines()
        if not names:
            raise ValueError("No dedicated backup found")
        for name in names:
            timestamp(name)  # Validate every name before any shell interpolation.
        name = max(names)
        now = dt.datetime.now(dt.timezone.utc)
        age = now - timestamp(name)
        if age < -dt.timedelta(minutes=5) or age > dt.timedelta(hours=26):
            raise ValueError("Latest backup is stale or has a future timestamp")
        checksum = remote(f"sudo -n cat {REMOTE}/{name}.sha256").split()
        if len(checksum) != 2 or not re.fullmatch(r"[0-9a-f]{64}", checksum[0]) or checksum[1] != f"{REMOTE}/{name}":
            raise ValueError("Unexpected checksum record")
        size = int(remote(f"sudo -n stat -c %s {REMOTE}/{name}").strip())
        if size < 1 or size > MAX_ARCHIVE:
            raise ValueError("Archive exceeds the reviewed size bound")
        final = DESTINATION / name
        partial = DESTINATION / (name + ".partial")
        if final.is_symlink():
            raise ValueError("Backup destination must not be a symlink")
        if final.exists():
            if digest(final) != checksum[0]:
                raise ValueError("Existing off-host archive differs; operator review required")
        else:
            if shutil.disk_usage(DESTINATION).free < size + 512 * 1024**2:
                raise ValueError("Insufficient off-host backup space")
            handle = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                with os.fdopen(handle, "wb") as output:
                    remote(f"sudo -n cat {REMOTE}/{name}", output)
                    output.flush()
                    os.fsync(output.fileno())
                if partial.stat().st_size != size or digest(partial) != checksum[0]:
                    raise ValueError("Copied archive checksum or size mismatch")
                expanded = 0
                with gzip.open(partial, "rb") as source:
                    while chunk := source.read(1024**2):
                        expanded += len(chunk)
                        if expanded > MAX_EXPANDED:
                            raise ValueError("Expanded archive exceeds the reviewed size bound")
                os.replace(partial, final)
            finally:
                partial.unlink(missing_ok=True)
        checksum_path = DESTINATION / (name + ".sha256")
        if checksum_path.is_symlink():
            raise ValueError("Checksum destination must not be a symlink")
        checksum_path.write_text(f"{checksum[0]}  {name}\n")
        checksum_path.chmod(0o600)
        # Daily cleanup must happen before the seven-day maximum, not one
        # daily interval afterward. Match local retention with an hour margin.
        cutoff = now - dt.timedelta(days=5, hours=23)
        for path in DESTINATION.iterdir():
            archive_name = path.name.removesuffix(".sha256")
            if NAME.fullmatch(archive_name) and not path.is_symlink() and path.is_file() and timestamp(archive_name) < cutoff:
                path.unlink()
        return name
    finally:
        os.close(lock)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        collect()
    except (ValueError, OSError, subprocess.SubprocessError):
        print("Candids off-host backup failed; inspect archive freshness, checksum, capacity and SSH access.", file=sys.stderr)
        sys.exit(1)
    print("Candids off-host backup verified; seven-day retention applied.")
