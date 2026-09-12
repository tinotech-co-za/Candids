#!/usr/bin/env python3
"""Read only the dedicated stack's operational state; never emit credentials."""
import json
import datetime as dt
from pathlib import Path
import shutil
import re
import subprocess
import urllib.request

RUNTIME = Path('/opt/tinotech-candids')
STATE = Path('/home/dev/.local/share/homelab/tinotech-candids')


def command(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True, timeout=15).stdout.strip()


def main():
    if (STATE / 'INSTANCE').read_text().strip() != 'tinotech-candids':
        raise ValueError('Instance differs')
    result = {'freeBytes': shutil.disk_usage(STATE).free, 'containers': {}}
    for name in ('tinotech-candids-web-1', 'tinotech-candids-candids-convex-1'):
        value = json.loads(command('docker', 'inspect', '--format', '{{json .State}}', name))
        result['containers'][name] = {'running': value.get('Running') is True,
            'healthy': (value.get('Health') or {}).get('Status') == 'healthy'}
    env = dict(line.split('=', 1) for line in (RUNTIME / 'secrets/operator.env').read_text().splitlines() if '=' in line)
    request = urllib.request.Request('http://127.0.0.1:3210/api/query', method='POST',
        data=b'{"path":"ops:status","format":"convex_encoded_json","args":[{}]}',
        headers={'content-type': 'application/json', 'authorization': 'Convex ' + env['CONVEX_SELF_HOSTED_ADMIN_KEY']})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        data = json.loads(response.read(10000))
    if data.get('status') != 'success':
        raise ValueError('Backend health query failed')
    result['backend'] = data['value']
    result['backupService'] = command('systemctl', 'show', 'tinotech-candids-backup.service', '-p', 'Result', '--value')
    result['backupTimer'] = command('systemctl', 'is-active', 'tinotech-candids-backup.timer')
    names = [p.name for p in (STATE / 'backups').iterdir() if re.fullmatch(r'candids-\d{8}T\d{6}Z\.tar\.gz', p.name) and p.is_file() and not p.is_symlink()]
    result['lastBackupAt'] = dt.datetime.strptime(max(names)[8:24], '%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc).timestamp()
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('{"probeFailed":true}')
        raise SystemExit(1)
