import os
import platform
import tempfile
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