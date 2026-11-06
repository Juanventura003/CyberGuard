import time
import threading
from collections import deque

MAX_EVENTS = 500

_events = deque(maxlen=MAX_EVENTS)
_previous_processes = {}
_initialized = False
_next_event_id = 0

_lock = threading.Lock()


def process_identity(process):
    return (
        process.get("pid"),
        process.get("create_time"),
    )


def add_event(event_type, severity, message, process=None):
    global _next_event_id

    _next_event_id += 1

    event = {
        "id": _next_event_id,
        "timestamp": time.time(),
        "event_type": event_type,
        "severity": severity,
        "message": message,
        "pid": process.get("pid") if process else None,
        "process_name": (
            process.get("name") if process else None
        ),
    }

    _events.appendleft(event)
    return event


def update_process_timeline(processes):
    """Compare completed process snapshots and record changes."""

    global _previous_processes, _initialized

    current = {
        process_identity(process): process
        for process in processes
    }

    with _lock:
        if not _initialized:
            _previous_processes = current
            _initialized = True

            add_event(
                "monitoring_started",
                "info",
                "CyberGuard process monitoring initialized.",
            )

            return

        previous_keys = set(_previous_processes)
        current_keys = set(current)

        # Newly observed processes
        for identity in current_keys - previous_keys:
            process = current[identity]

            add_event(
                "process_started",
                "info",
                f"{process.get('name')} was newly observed.",
                process,
            )

        for identity in previous_keys - current_keys:
            process = _previous_processes[identity]

            add_event(
                "process_ended",
                "info",
                f"{process.get('name')} is no longer running.",
                process,
            )

        for identity in current_keys & previous_keys:
            current_process = current[identity]
            previous_process = _previous_processes[identity]

            current_analysis = current_process.get("analysis", {})
            previous_analysis = previous_process.get("analysis", {})

            current_risk = current_analysis.get(
                "risk_level_v2", "low"
            )

            previous_risk = previous_analysis.get(
                "risk_level_v2", "low"
            )

            if current_risk != previous_risk:
                severity = (
                    "high" if current_risk == "high"
                    else "warning"
                    if current_risk == "moderate"
                    else "info"
                )

                add_event(
                    "risk_changed",
                    severity,
                    (
                        f"{current_process.get('name')} risk "
                        f"changed from {previous_risk} "
                        f"to {current_risk}."
                    ),
                    current_process,
                )

        _previous_processes = current

def get_security_events(limit=100):
    with _lock:
        return {
            "events": list(_events)[:limit],
            "total": len(_events),
        }

def record_process_termination(pid, name):
    with _lock:
        add_event(
            "termination_requested",
            "warning",
            f"CyberGuard successfully ended {name}.",
            {"pid": pid, "name": name},
        )