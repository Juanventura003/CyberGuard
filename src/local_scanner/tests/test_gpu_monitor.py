import plistlib
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gpu_monitor


class MacGPUReadingTests(unittest.TestCase):
    def read(self, registry):
        result = subprocess.CompletedProcess([], 0, stdout=plistlib.dumps(registry))
        with patch.object(gpu_monitor.platform, 'system', return_value='Darwin'), \
             patch.object(gpu_monitor.subprocess, 'run', return_value=result) as run:
            value = gpu_monitor.get_mac_gpu_usage()
            self.assertEqual(run.call_args.args[0][0], '/usr/sbin/ioreg')
            self.assertEqual(run.call_args.kwargs['timeout'], 5)
            return value

    def test_idle_is_a_valid_measurement(self):
        self.assertEqual(self.read([{'PerformanceStatistics': {'Device Utilization %': 0}}])['usage_percent'], 0)

    def test_nested_and_multiple_devices_use_busiest(self):
        result = self.read([
            {'IORegistryEntryChildren': [{'PerformanceStatistics': {'Device Utilization %': 32.25}}]},
            {'PerformanceStatistics': {'Device Utilization %': 72}},
        ])
        self.assertEqual(result['usage_percent'], 72)

    def test_invalid_or_missing_measurements_are_unavailable(self):
        for value in (True, '30', -1, 101, float('nan'), float('inf')):
            with self.subTest(value=value):
                self.assertIsNone(self.read([{'PerformanceStatistics': {'Device Utilization %': value}}]))
        self.assertIsNone(self.read([{'PerformanceStatistics': {'Renderer Utilization %': 40}}]))
        self.assertIsNone(self.read({'unexpected': 'shape'}))

    def test_failure_and_malformed_plist_are_unavailable(self):
        failures = [OSError('missing'), subprocess.TimeoutExpired('ioreg', 5), subprocess.CalledProcessError(1, 'ioreg')]
        with patch.object(gpu_monitor.platform, 'system', return_value='Darwin'):
            for failure in failures:
                with patch.object(gpu_monitor.subprocess, 'run', side_effect=failure):
                    self.assertIsNone(gpu_monitor.get_mac_gpu_usage())
            with patch.object(gpu_monitor.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=b'bad plist')):
                self.assertIsNone(gpu_monitor.get_mac_gpu_usage())

    def test_mac_dispatch_and_unsupported_fallback(self):
        with patch.object(gpu_monitor.platform, 'system', return_value='Darwin'), \
             patch.object(gpu_monitor, 'get_mac_gpu_usage', return_value={'supported': True, 'usage_percent': 14}) as mac, \
             patch.object(gpu_monitor, 'get_nvidia_gpu_usage', return_value=None) as nvidia:
            self.assertEqual(gpu_monitor.get_gpu_stats()['usage_percent'], 14)
            nvidia.assert_not_called()
            mac.return_value = None
            self.assertIsNone(gpu_monitor.get_gpu_stats()['usage_percent'])

    def test_windows_dispatch_is_preserved(self):
        with patch.object(gpu_monitor.platform, 'system', return_value='Windows'), \
             patch.object(gpu_monitor, 'get_nvidia_gpu_usage', return_value=None), \
             patch.object(gpu_monitor, 'get_windows_gpu_usage', return_value={'supported': True, 'usage_percent': 25}), \
             patch.object(gpu_monitor, 'get_mac_gpu_usage') as mac:
            self.assertEqual(gpu_monitor.get_gpu_stats()['usage_percent'], 25)
            mac.assert_not_called()


if __name__ == '__main__':
    unittest.main()
