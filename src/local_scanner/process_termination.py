import os
import platform
import tempfile
import math
import threading
from pathlib import Path

import psutil


PROTECTED_NAMES = {
    "system", "system idle process", "registry",
    "smss.exe", "csrss.exe", "wininit.exe",
    "winlogon.exe", "services.exe", "lsass.exe",
    "lsaiso.exe", "svchost.exe", "dwm.exe",
    "fontdrvhost.exe", "memory compression",
    "memcompression", "secure system",
    "sihost.exe", "taskhostw.exe",

    "kernel_task", "launchd", "windowserver",
    "loginwindow", "configd", "opendirectoryd",
    "securityd", "runningboardd",
    "kernelmanagerd", "powerd",
}

SCANNER_PID = os.getpid()


def _deny(reason):
    return {
        "eligible": False,
        "reason": reason,
    }


def _protected_scanner_family(pid):
    """Protect the scanner and its ancestor processes."""
    try:
        current = psutil.Process(SCANNER_PID)

        protected = {SCANNER_PID}

        for ancestor in current.parents():
            protected.add(ancestor.pid)

        return pid in protected
    except psutil.Error:
        return pid == SCANNER_PID


def check_termination_eligibility(
    pid,
    expected_create_time,
):
    if (
        not isinstance(pid, int)
        or isinstance(pid, bool)
        or pid <= 0
    ):
        return _deny("Invalid process ID.")

    if expected_create_time is None:
        return _deny(
            "Process identity cannot be verified."
        )

    try:
        expected_create_time = float(
            expected_create_time
        )

        proc = psutil.Process(pid)

        if abs(
            proc.create_time() - expected_create_time
        ) > 0.001:
            return _deny(
                "The selected process has changed."
            )

        if _protected_scanner_family(pid):
            return _deny(
                "CyberGuard and its parent processes "
                "are protected."
            )

        name = proc.name().casefold()

        if name in PROTECTED_NAMES:
            return _deny(
                "This operating system process "
                "is protected."
            )

        system = platform.system()

        if system == "Windows":
            owner = proc.username().casefold()
            current_user = psutil.Process(
                os.getpid()
            ).username().casefold()

            if owner != current_user:
                return _deny(
                    "This process belongs to another "
                    "user or system account."
                )

        elif system == "Darwin":
            if proc.uids().real != os.getuid():
                return _deny(
                    "This process belongs to another "
                    "user or system account."
                )

        else:
            return _deny(
                "Unsupported operating system."
            )

        executable = proc.exe()

        if not executable:
            return _deny(
                "Executable identity could not "
                "be verified."
            )

        path = Path(executable).resolve(
            strict=False
        )

        if not path.is_file():
            return _deny(
                "Executable path could not "
                "be verified."
            )

        temp = Path(
            tempfile.gettempdir()
        ).resolve(strict=False)

        if path == temp or temp in path.parents:
            return _deny(
                "Processes running from temporary "
                "folders are restricted."
            )

        if system == "Darwin":
            protected_dirs = [
                Path("/System"),
                Path("/usr/sbin"),
                Path("/usr/libexec"),
                Path("/sbin"),
                Path("/bin"),
            ]

            for directory in protected_dirs:
                if (
                    path == directory
                    or directory in path.parents
                ):
                    return _deny(
                        "This macOS system executable "
                        "is protected."
                    )

        return {
            "eligible": True,
            "reason": (
                "This user-owned process passed "
                "CyberGuard's termination checks."
            ),
            "pid": pid,
            "name": proc.name(),
            "create_time": proc.create_time(),
        }

    except (
        psutil.NoSuchProcess,
        psutil.ZombieProcess,
    ):
        return _deny(
            "This process is no longer running."
        )

    except (
        psutil.AccessDenied,
        PermissionError,
    ):
        return _deny(
            "Permission denied for this process."
        )

    except (
        ValueError,
        TypeError,
        OSError,
    ):
        return _deny(
            "Unable to verify process eligibility."
        )


def terminate_eligible_process(
    pid,
    expected_create_time,
):
    result = check_termination_eligibility(
        pid,
        expected_create_time,
    )

    if not result["eligible"]:
        return {
            "success": False,
            "terminated": False,
            "message": result["reason"],
        }

    try:
        proc = psutil.Process(pid)

        if abs(
            proc.create_time()
            - float(expected_create_time)
        ) > 0.001:
            return {
                "success": False,
                "terminated": False,
                "message": (
                    "Process identity changed. "
                    "No action taken."
                ),
            }

        proc.terminate()

        try:
            proc.wait(timeout=3)

            return {
                "success": True,
                "terminated": True,
                "name": result["name"],
                "message": (
                    f"{result['name']} was terminated."
                ),
            }

        except psutil.TimeoutExpired:
            return {
                "success": False,
                "terminated": False,
                "message": (
                    "Termination was requested, but "
                    "the process has not exited yet."
                ),
            }

    except psutil.NoSuchProcess:
        return {
            "success": True,
            "terminated": False,
            "message": (
                "The selected process has "
                "already exited."
            ),
        }

    except (
        psutil.AccessDenied,
        PermissionError,
        OSError,
    ):
        return {
            "success": False,
            "terminated": False,
            "message": (
                "The operating system denied "
                "termination."
            ),
        }

APPLICATION_TERMINATION_LOCK = threading.Lock()
MAX_APPLICATION_PROCESSES = 100


def _same_identity(proc, expected_create_time):
    try:
        return (
            abs(
                proc.create_time()
                - float(expected_create_time)
            ) <= 0.001
        )
    except (psutil.Error, ValueError, TypeError):
        return False


def _application_executable(proc):
    try:
        return os.path.normcase(
            os.path.realpath(proc.exe())
        )
    except (psutil.Error, OSError):
        return None


def _application_group_key(executable):
    """
    Use a conservative application identity.

    macOS: the containing .app bundle.
    Windows: the executable's parent directory.

    This is a grouping hint, not a security guarantee.
    """
    path = Path(executable)

    if platform.system() == "Darwin":
        for part in [path, *path.parents]:
            if part.name.lower().endswith(".app"):
                return str(part)

    return str(path.parent)


def _find_application_candidates(pid, expected_create_time):
    """
    Find the selected process and related descendants.

    Never group unrelated processes solely by name.
    """
    selected = psutil.Process(pid)

    if not _same_identity(selected, expected_create_time):
        raise ValueError("The selected process has changed.")

    selected_executable = _application_executable(selected)

    if not selected_executable:
        raise ValueError(
            "The application's executable could not be verified."
        )

    selected_group = _application_group_key(
        selected_executable
    )

    root = selected
    visited = set()

    while True:
        if root.pid in visited:
            break

        visited.add(root.pid)

        try:
            parent = root.parent()

            if parent is None:
                break

            parent_executable = _application_executable(
                parent
            )

            if not parent_executable:
                break

            if (
                _application_group_key(parent_executable)
                != selected_group
            ):
                break

            root = parent

        except psutil.Error:
            break

    candidates = [root]

    try:
        descendants = root.children(recursive=True)
    except psutil.Error:
        descendants = []

    for child in descendants:
        executable = _application_executable(child)

        if not executable:
            continue

        if (
            _application_group_key(executable)
            == selected_group
        ):
            candidates.append(child)

    unique = {}

    for proc in candidates:
        try:
            unique[(proc.pid, proc.create_time())] = proc
        except psutil.Error:
            continue

    return list(unique.values())


def check_application_termination(
    pid,
    expected_create_time,
):
    """
    Preview which related processes can safely
    be terminated. No process is stopped here.
    """
    selected_check = check_termination_eligibility(
        pid,
        expected_create_time,
    )

    if not selected_check["eligible"]:
        return {
            "eligible": False,
            "reason": selected_check["reason"],
            "processes": [],
        }

    try:
        candidates = _find_application_candidates(
            pid,
            expected_create_time,
        )

        if len(candidates) > MAX_APPLICATION_PROCESSES:
            return {
                "eligible": False,
                "reason": (
                    "Too many related processes were found. "
                    "No action taken."
                ),
                "processes": [],
            }

        if not candidates:
            return {
                "eligible": False,
                "reason": "No matching processes were found.",
                "processes": [],
            }

        preview = []

        for proc in candidates:
            try:
                created = proc.create_time()
                name = proc.name()

                check = check_termination_eligibility(
                    proc.pid,
                    created,
                )

                preview.append({
                    "pid": proc.pid,
                    "name": name,
                    "create_time": created,
                    "eligible": check["eligible"],
                    "reason": check["reason"],
                })

            except psutil.Error:
                return {
                    "eligible": False,
                    "reason": (
                        "A related process changed during "
                        "the safety check. No action taken."
                    ),
                    "processes": [],
                }

        blocked = [
            item for item in preview
            if not item["eligible"]
        ]

        if blocked:
            return {
                "eligible": False,
                "reason": (
                    "At least one related process failed "
                    "CyberGuard's safety checks. "
                    "No action taken."
                ),
                "processes": preview,
            }

        return {
            "eligible": True,
            "reason": (
                f"{len(preview)} related process(es) "
                "passed CyberGuard's safety checks."
            ),
            "pid": pid,
            "create_time": expected_create_time,
            "processes": preview,
        }

    except (psutil.Error, ValueError, OSError) as exc:
        return {
            "eligible": False,
            "reason": str(exc),
            "processes": [],
        }


def terminate_application(
    pid,
    expected_create_time,
):
    """
    Terminate the verified application process group.

    Every process is rechecked immediately before
    termination. Partial outcomes are reported.
    """
    if not APPLICATION_TERMINATION_LOCK.acquire(
        blocking=False
    ):
        return {
            "success": False,
            "terminated": False,
            "message": (
                "Another application termination "
                "is already in progress."
            ),
            "results": [],
        }

    try:
        preview = check_application_termination(
            pid,
            expected_create_time,
        )

        if not preview["eligible"]:
            return {
                "success": False,
                "terminated": False,
                "message": preview["reason"],
                "results": [],
            }

        approved = {
            (item["pid"], item["create_time"])
            for item in preview["processes"]
        }

        current = _find_application_candidates(
            pid,
            expected_create_time,
        )

        current_ids = {
            (proc.pid, proc.create_time())
            for proc in current
        }

        if current_ids != approved:
            return {
                "success": False,
                "terminated": False,
                "message": (
                    "Application processes changed. "
                    "Please review and try again."
                ),
                "results": [],
            }

        def depth(proc):
            count = 0

            try:
                parent = proc.parent()

                while parent is not None and count < 100:
                    count += 1
                    parent = parent.parent()

            except psutil.Error:
                pass

            return count

        ordered = sorted(
            current,
            key=depth,
            reverse=True,
        )

        results = []

        for proc in ordered:
            created = proc.create_time()

            # Recheck existing security restrictions.
            check = check_termination_eligibility(
                proc.pid,
                created,
            )

            if not check["eligible"]:
                results.append({
                    "pid": proc.pid,
                    "name": preview["processes"][0]["name"],
                    "success": False,
                    "message": check["reason"],
                })
                continue

            result = terminate_eligible_process(
                proc.pid,
                created,
            )

            results.append({
                "pid": proc.pid,
                "name": check["name"],
                "success": bool(
                    result.get("success")
                    and result.get("terminated")
                ),
                "message": result.get("message", ""),
            })

        stopped = sum(
            1 for item in results if item["success"]
        )

        total = len(results)

        all_stopped = stopped == total

        return {
            "success": all_stopped,
            "terminated": stopped > 0,
            "name": preview["processes"][0]["name"],
            "message": (
                f"Stopped {stopped} of {total} "
                "related processes."
            ),
            "terminated_count": stopped,
            "total_count": total,
            "results": results,
        }

    except (psutil.Error, ValueError, OSError):
        return {
            "success": False,
            "terminated": False,
            "message": (
                "Application processes changed or "
                "could not be accessed."
            ),
            "results": [],
        }

    finally:
        APPLICATION_TERMINATION_LOCK.release()