import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('health', Path(__file__).parents[1] / 'deploy/devbox/health-monitor.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.now = 1800000000
        self.remote = {'freeBytes': 3 * 1024**3, 'containers': {'app': {'running': True, 'healthy': True}, 'backend': {'running': True, 'healthy': True}},
            'backend': {'activeAlbums': 5, 'managedEventCap': 5, 'lastCleanupAt': self.now * 1000, 'overdueExpiredAlbums': 0},
            'backupTimer': 'active', 'backupService': 'success', 'lastBackupAt': self.now}

    def test_bounded_pilot_and_fresh_recovery_are_healthy(self):
        self.assertTrue(health.evaluate(self.remote, True, True, self.now)['ok'])

    def test_convex_encoded_integral_float_is_accepted_but_other_counts_are_rejected(self):
        self.remote['backend']['activeAlbums'] = 5.0
        self.assertTrue(health.evaluate(self.remote, True, True, self.now)['ok'])
        for invalid in (True, 1.5, float('nan'), float('inf'), 6.0, -1.0, '5'):
            self.remote['backend']['activeAlbums'] = invalid
            self.assertFalse(health.evaluate(self.remote, True, True, self.now)['ok'])

    def test_stale_cleanup_capacity_disk_timer_and_backup_fail_closed(self):
        mutations = [lambda x: x['backend'].update(lastCleanupAt=(self.now - 5000) * 1000),
            lambda x: x['backend'].update(overdueExpiredAlbums=1), lambda x: x['backend'].update(activeAlbums=6),
            lambda x: x.update(freeBytes=1), lambda x: x.update(backupTimer='inactive'),
            lambda x: x.update(backupService='exit-code'), lambda x: x.update(lastBackupAt=self.now-27*3600),
            lambda x: x['containers']['app'].update(healthy=False)]
        for mutate in mutations:
            value = copy.deepcopy(self.remote)
            mutate(value)
            self.assertFalse(health.evaluate(value, True, True, self.now)['ok'])
        self.assertFalse(health.evaluate(self.remote, False, True, self.now)['ok'])
        self.assertFalse(health.evaluate(self.remote, True, False, self.now)['ok'])
        self.assertFalse(health.evaluate({}, True, True, self.now)['ok'])

    def test_unreachable_components_preserve_last_success_and_write_fresh_failure(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(health, 'ROOT', Path(temp)):
            directory = Path(temp) / 'status'
            directory.mkdir(mode=0o700)
            target = directory / 'health.json'
            target.write_text(json.dumps({'lastSuccessAt': 123}))
            with patch.object(health, 'run', side_effect=TimeoutError), patch.object(health, 'public_health', return_value=True), patch.object(health, 'backup_health', return_value=True):
                self.assertFalse(health.collect())
            value = json.loads(target.read_text())
            self.assertEqual(value['lastSuccessAt'], 123)
            self.assertFalse(value['checks']['containers'])
            self.assertTrue(value['checks']['publicApp'])
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertFalse((directory / 'health.json.partial').exists())


if __name__ == '__main__':
    unittest.main()
