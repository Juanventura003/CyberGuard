import math
import plistlib
import platform
import subprocess
import threading
import time


def get_nvidia_gpu_usage():
    """Read NVIDIA GPU utilization when NVML is available."""

    try:
        import pynvml

        pynvml.nvmlInit()

        try:
            count = pynvml.nvmlDeviceGetCount()

            if count == 0:
                return None

            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)

            return {
                "supported": True,
                "usage_percent": round(
                    float(utilization.gpu), 1
                ),
                "message": "NVIDIA GPU utilization",
            }

        finally:
            pynvml.nvmlShutdown()

    except Exception:
        return None


def get_windows_gpu_usage():
    """Read Windows GPU Engine performance counters."""

    if platform.system() != "Windows":
        return None

    script = r"""
    $ErrorActionPreference = 'Stop'

    $samples = Get-Counter '\GPU Engine(*)\Utilization Percentage' `
        -SampleInterval 1 -MaxSamples 1

    $values = $samples.CounterSamples |
        Where-Object { $_.Status -eq 0 } |
        Group-Object {
            if ($_.Path -match 'engtype_([^\\]+)$') {
                $matches[1]
            } else {
                'unknown'
            }
        }

    $engines = @()

    foreach ($group in $values) {
        $sum = (
            $group.Group |
            Measure-Object -Property CookedValue -Sum
        ).Sum

        $engines += [PSCustomObject]@{
            Engine = $group.Name
            Usage = $sum
        }
    }

    if ($engines.Count -eq 0) {
        throw 'No GPU counters available'
    }

    $maximum = (
        $engines |
        Measure-Object -Property Usage -Maximum
    ).Maximum

    [Math]::Round(
        [Math]::Min(100, [Math]::Max(0, $maximum)), 1
    )
    """

    try:
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=True,
        )

        usage = float(result.stdout.strip())

        return {
            "supported": True,
            "usage_percent": usage,
            "message": "Windows GPU engine utilization estimate",
        }

    except (
        subprocess.SubprocessError,
        ValueError,
        OSError,
    ):
        return None


def get_mac_gpu_usage():
    """Read driver-reported GPU utilization without administrator privileges.

    IOAccelerator counters vary by macOS version and GPU driver. Only use
    explicit device utilization percentages; missing counters are unavailable,
    not zero. For multiple GPUs, report the busiest device rather than sum them.
    """
    if platform.system() != "Darwin":
        return None

    try:
        result = subprocess.run(
            ["/usr/sbin/ioreg", "-r", "-c", "IOAccelerator", "-a"],
            capture_output=True,
            timeout=5,
            check=True,
        )
        registry = plistlib.loads(result.stdout)
        if not isinstance(registry, list):
            return None
        readings = []
        pending = list(registry)
        while pending:
            entry = pending.pop()
            if not isinstance(entry, dict):
                continue
            children = entry.get("IORegistryEntryChildren")
            if isinstance(children, list):
                pending.extend(children)
            statistics = entry.get("PerformanceStatistics")
            if not isinstance(statistics, dict):
                continue
            usage = statistics.get("Device Utilization %")
            if (
                isinstance(usage, (int, float))
                and not isinstance(usage, bool)
                and math.isfinite(usage)
                and 0 <= usage <= 100
            ):
                readings.append(float(usage))
        if not readings:
            return None
        return {
            "supported": True,
            "usage_percent": round(max(readings), 1),
            "message": "macOS driver-reported GPU utilization (busiest device)",
        }
    except (subprocess.SubprocessError, OSError, ValueError, OverflowError):
        return None


def get_gpu_stats():
    """Return GPU utilization when supported."""

    operating_system = platform.system()
    if operating_system == "Darwin":
        mac = get_mac_gpu_usage()
        if mac is not None:
            return mac

    nvidia = get_nvidia_gpu_usage()

    if nvidia is not None:
        return nvidia
    if operating_system == "Windows":
        windows = get_windows_gpu_usage()

        if windows is not None:
            return windows

    return {
        "supported": False,
        "usage_percent": None,
        "message": (
            "GPU utilization is unavailable on this device. "
            "This does not affect other monitoring features."
        ),
    }

_GPU_REFRESH_SECONDS = 3

_gpu_lock = threading.Lock()
_gpu_thread = None

_gpu_cache = {
    "supported": False,
    "usage_percent": None,
    "message": "GPU monitoring is initializing...",
}

def _gpu_monitor_worker():
    """Continuously collect GPU usage in the background."""

    global _gpu_cache

    while True:
        try:
            result = get_gpu_stats()

            with _gpu_lock:
                _gpu_cache = result

        except Exception:
            with _gpu_lock:
                _gpu_cache = {
                    "supported": False,
                    "usage_percent": None,
                    "message": "GPU monitoring temporarily unavailable.",
                }

        time.sleep(_GPU_REFRESH_SECONDS)

def start_gpu_monitor():
    """Start one background GPU monitoring thread."""

    global _gpu_thread

    with _gpu_lock:
        if _gpu_thread is not None and _gpu_thread.is_alive():
            return

        _gpu_thread = threading.Thread(
            target=_gpu_monitor_worker,
            name="CyberGuardGPUMonitor",
            daemon=True,
        )

        _gpu_thread.start()

def get_cached_gpu_stats():
    """Return the latest GPU reading without blocking."""

    start_gpu_monitor()

    with _gpu_lock:
        return _gpu_cache.copy()
