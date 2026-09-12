#!/usr/bin/env python3
"""Write bounded private Candids health evidence; no customer data or messages."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path.home() / '.local/share/tinotech-candids'
ORIGIN = 'https://candids.tinotech.co.za'


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True, timeout=60).stdout.strip()


def evaluate(remote, public_ok, offhost, now):
    backend = remote.get('backend') or {}
    containers = remote.get('containers') or {}
    checks = {
        'publicApp': public_ok is True,
        'containers': len(containers) == 2 and all(x.get('running') is True and x.get('healthy') is True for x in containers.values()),
        'disk': type(remote.get('freeBytes')) is int and remote['freeBytes'] >= 2 * 1024**3,
        'capacity': type(backend.get('activeAlbums')) in (int, float) and 0 <= backend['activeAlbums'] <= 5 and backend['activeAlbums'] == int(backend['activeAlbums']) and backend.get('managedEventCap') == 5,
        'cleanup': type(backend.get('lastCleanupAt')) in (int, float) and -300 <= now - backend['lastCleanupAt'] / 1000 <= 4200 and backend.get('overdueExpiredAlbums') == 0,
        'localBackupTimer': remote.get('backupTimer') == 'active',
        'localBackupService': remote.get('backupService') == 'success',
        'localBackupFresh': type(remote.get('lastBackupAt')) in (int, float) and -300 <= now - remote['lastBackupAt'] <= 26 * 3600,
        'offhostBackup': offhost is True,
    }
    return {'ok': all(checks.values()), 'checks': checks,
            'activeAlbums': backend.get('activeAlbums'), 'freeBytes': remote.get('freeBytes'),
            'cleanupAt': backend.get('lastCleanupAt')}


def public_health():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    with opener.open(ORIGIN + '/demo', timeout=15) as response:
        if response.status != 200:
            return False
    try:
        opener.open(ORIGIN + '/api/album', timeout=15)
    except urllib.error.HTTPError as error:
        return error.code == 401 and 'no-store' in error.headers.get('cache-control', '')
    return False


def backup_health(now):
    directory = ROOT / 'backups'
    names = [p for p in directory.iterdir() if re.fullmatch(r'candids-\d{8}T\d{6}Z\.tar\.gz', p.name) and p.is_file() and not p.is_symlink()]
    latest = max(names, key=lambda p: p.name)
    timestamp = dt.datetime.strptime(latest.name[8:24], '%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc).timestamp()
    if not -300 <= now - timestamp <= 26 * 3600 or not 0 < latest.stat().st_size <= 2 * 1024**3:
        return False
    checksum_path = latest.with_name(latest.name + '.sha256')
    if checksum_path.is_symlink():
        return False
    checksum = checksum_path.read_text().split()
    if len(checksum) != 2 or checksum[1] != latest.name or not re.fullmatch(r'[a-f0-9]{64}', checksum[0]):
        return False
    with latest.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != checksum[0]:
            return False
    return run('systemctl', '--user', 'is-active', 'tinotech-candids-offhost-backup.timer') == 'active' and run('systemctl', '--user', 'show', 'tinotech-candids-offhost-backup.service', '-p', 'Result', '--value') == 'success'


def collect():
    directory = ROOT / 'status'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise ValueError('Status must be private')
    lock = os.open(directory / '.health.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = dt.datetime.now(dt.timezone.utc).timestamp()
        # Independent checks still run when another component is unavailable.
        try:
            remote = json.loads(run('ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'devbox', 'sudo -n /usr/bin/python3 /opt/tinotech-candids/health-probe.py'))
        except Exception:
            remote = {}
        try:
            public_ok = public_health()
        except Exception:
            public_ok = False
        try:
            offhost = backup_health(now)
        except Exception:
            offhost = False
        result = evaluate(remote, public_ok, offhost, now)
        target = directory / 'health.json'
        if target.is_symlink():
            raise ValueError('Status file must not be a symlink')
        prior = json.loads(target.read_text()) if target.exists() else {}
        result.update(checkedAt=now, lastSuccessAt=now if result['ok'] else prior.get('lastSuccessAt'))
        partial = target.with_name('health.json.partial')
        fd = os.open(partial, os.O_CREAT | os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(result, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(partial, target)
        return result['ok']
    finally:
        os.close(lock)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        ok = collect()
    except Exception:
        ok = False
    print('Candids health verified.' if ok else 'Candids health needs review; inspect private status/health.json and service journal.')
    sys.exit(0 if ok else 1)
