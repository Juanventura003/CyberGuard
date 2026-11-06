import platform
from pathlib import Path

import psutil

import time
from threading import Lock

from gpu_monitor import get_cached_gpu_stats

def get_system_stats():
    """Collect current system performance information."""

    cpu_usage = psutil.cpu_percent(interval=None)

    memory = psutil.virtual_memory()

    if platform.system() == "Windows":
        disk_path = Path.home().anchor
    else:
        disk_path = "/"

    disk = psutil.disk_usage(str(disk_path))

    return {
        "operating_system": platform.system(),
        "cpu": {
            "usage_percent": cpu_usage,
            "cores": psutil.cpu_count(logical=True),
        },
        "memory": {
            "usage_percent": memory.percent,
            "total_gb": round(memory.total / (1024 ** 3), 2),
            "used_gb": round(memory.used / (1024 ** 3), 2),
            "available_gb": round(memory.available / (1024 ** 3), 2),
        },
        "disk": {
            "usage_percent": disk.percent,
            "total_gb": round(disk.total / (1024 ** 3), 2),
            "used_gb": round(disk.used / (1024 ** 3), 2),
            "free_gb": round(disk.free / (1024 ** 3), 2),
        },
        "gpu": get_cached_gpu_stats(),
    }

_process_lock = Lock()
_previous_cpu_times = {}
_previous_sample_time = None


def get_process_metadata(proc, parent_names):
    """Retrieve process metadata using cached parent names."""

    metadata = {
        "executable": None,
        "parent_pid": None,
        "parent_name": None,
    }

    try:
        metadata["executable"] = proc.exe()
    except (
        psutil.AccessDenied,
        psutil.NoSuchProcess,
        psutil.ZombieProcess,
        OSError,
    ):
        pass

    try:
        parent_pid = proc.ppid()
        metadata["parent_pid"] = parent_pid
        metadata["parent_name"] = parent_names.get(parent_pid)
    except (
        psutil.AccessDenied,
        psutil.NoSuchProcess,
        psutil.ZombieProcess,
        OSError,
    ):
        pass

    return metadata


def get_running_processes():
    """Collect running processes using cached process metadata."""

    global _previous_cpu_times, _previous_sample_time

    processes = []
    current_cpu_times = {}
    now = time.monotonic()
    logical_cores = psutil.cpu_count(logical=True) or 1

    process_snapshot = list(
        psutil.process_iter([
            "pid",
            "ppid",
            "name",
            "username",
            "memory_info",
            "create_time",
            "status",
            "cpu_times",
            "exe",
        ])
    )

    parent_names = {}

    for proc in process_snapshot:
        try:
            parent_names[proc.pid] = proc.info.get("name")
        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            OSError,
        ):
            continue

    with _process_lock:
        elapsed = (
            now - _previous_sample_time
            if _previous_sample_time is not None
            else None
        )

        for proc in process_snapshot:
            try:
                info = proc.info

                pid = info["pid"]
                created = info.get("create_time")
                identity = (pid, created)

                cpu_times = info.get("cpu_times")

                if cpu_times is not None:
                    total_cpu_time = (
                        cpu_times.user + cpu_times.system
                    )

                    current_cpu_times[identity] = total_cpu_time

                    previous = _previous_cpu_times.get(identity)

                    if (
                        previous is not None
                        and elapsed is not None
                        and elapsed > 0
                    ):
                        cpu_percent = (
                            (total_cpu_time - previous)
                            / elapsed
                            / logical_cores
                            * 100
                        )
                        cpu_percent = max(
                            0,
                            min(100, cpu_percent)
                        )
                    else:
                        cpu_percent = 0.0
                else:
                    cpu_percent = 0.0

                memory_info = info.get("memory_info")

                memory_mb = (
                    memory_info.rss / (1024 ** 2)
                    if memory_info is not None
                    else 0.0
                )

                parent_pid = info.get("ppid")

                processes.append({
                    "pid": pid,
                    "name": info.get("name") or "Unknown",
                    "cpu_percent": round(cpu_percent, 1),
                    "memory_mb": round(memory_mb, 1),
                    "username": info.get("username"),
                    "status": info.get("status") or "unknown",
                    "create_time": created,
                    "executable": info.get("exe"),
                    "parent_pid": parent_pid,
                    "parent_name": parent_names.get(parent_pid),
                })

            except (
                psutil.NoSuchProcess,
                psutil.AccessDenied,
                psutil.ZombieProcess,
                OSError,
                KeyError,
            ):
                continue

        _previous_cpu_times = current_cpu_times
        _previous_sample_time = now

    processes.sort(
        key=lambda process: process["memory_mb"],
        reverse=True
    )

    return {
        "processes": processes,
        "total": len(processes),
    }


def get_process_details(pid: int):
    """Return additional information about one accessible process."""

    if pid <= 0:
        return None

    try:
        proc = psutil.Process(pid)

        with proc.oneshot():
            return {
                "pid": proc.pid,
                "name": proc.name(),
                "username": proc.username(),
                "status": proc.status(),
                "create_time": proc.create_time(),
                "executable": proc.exe(),
                "command_line": proc.cmdline(),
                "memory_mb": round(
                    proc.memory_info().rss / (1024 ** 2), 1
                ),
            }

    except psutil.NoSuchProcess:
        return None

    except (psutil.AccessDenied, psutil.ZombieProcess, OSError):
        try:
            proc = psutil.Process(pid)
            return {
                "pid": pid,
                "name": proc.name(),
                "username": None,
                "status": "restricted",
                "create_time": None,
                "executable": None,
                "command_line": None,
                "memory_mb": None,
            }
        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            psutil.ZombieProcess,
            OSError,
        ):
            return None