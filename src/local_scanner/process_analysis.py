import os
import psutil

from pathlib import Path
import tempfile
import platform
from application_metadata import generate_process_description

HIGH_CPU_THRESHOLD = 40.0
HIGH_MEMORY_MB_THRESHOLD = 1500.0

SYSTEM_EXCEPTIONS = {
    "system idle process",
    "system",
    "registry",
    "kernel_task",
}

_resource_history = {}

HIGH_CPU_CONSECUTIVE_READINGS = 3
HIGH_MEMORY_CONSECUTIVE_READINGS = 3


def check_executable_location(executable):
    """Identify executables launched from temporary directories."""

    if not executable:
        return False

    try:
        path = Path(executable).resolve(strict=False)
        temp_path = Path(tempfile.gettempdir()).resolve(strict=False)

        return path == temp_path or temp_path in path.parents
    except (OSError, ValueError):
        return False


def analyze_process(process):
    name = str(process.get("name") or "Unknown")
    normalized_name = name.lower()

    cpu = float(process.get("cpu_percent") or 0)
    memory = float(process.get("memory_mb") or 0)

    pid = process.get("pid")
    created = process.get("create_time")
    identity = (pid, created)

    executable = process.get("executable")
    parent_name = process.get("parent_name")

    description, known_description = generate_process_description(
        name,
        executable
    )

    warnings = []
    recommendations = []

    previous = _resource_history.get(
        identity,
        {"cpu": 0, "memory": 0}
    )

    high_cpu_count = (
        previous["cpu"] + 1
        if cpu >= HIGH_CPU_THRESHOLD
        else 0
    )

    high_memory_count = (
        previous["memory"] + 1
        if memory >= HIGH_MEMORY_MB_THRESHOLD
        else 0
    )

    _resource_history[identity] = {
        "cpu": high_cpu_count,
        "memory": high_memory_count,
    }

    high_resource = False

    if normalized_name not in SYSTEM_EXCEPTIONS:
        if high_cpu_count >= HIGH_CPU_CONSECUTIVE_READINGS:
            warnings.append("Sustained high CPU usage")
            high_resource = True

        if high_memory_count >= HIGH_MEMORY_CONSECUTIVE_READINGS:
            warnings.append("Sustained high memory usage")
            high_resource = True

    unusual_location = check_executable_location(executable)

    risk_assessment = calculate_process_risk(
    process,
    unusual_location,
    high_resource,
)

    security_concern = False

    if unusual_location:
        warnings.append("Executable running from a temporary directory")

        recommendations.append(
            "Verify where this application came from and inspect "
            "its executable before trusting it."
        )

        if high_resource:
            security_concern = True

            recommendations.append(
                "This process combines an unusual executable location "
                "with sustained high resource usage. Consider scanning "
                "the executable using CyberGuard's Device Scanner."
            )

    if high_resource:
        recommendations.append(
            "Check whether this application is performing an expected "
            "task. Close unnecessary applications if performance suffers."
        )

    if not executable:
        recommendations.append(
            "Executable location is unavailable because of operating "
            "system restrictions or process access limitations."
        )

    if not recommendations:
        recommendations.append(
            "No unusual behavior was detected by the current rules. "
            "Continue monitoring if you do not recognize this process."
        )

    return {
        "description": description,
        "known_description": known_description,
        "warnings": warnings,
        "recommendations": recommendations,
        "high_resource": high_resource,
        "review_recommended": bool(warnings),
        "risk_level": (
            "review" if security_concern
            else "informational"
        ),
        "executable": executable,
        "parent_name": parent_name,
        "parent_pid": process.get("parent_pid"),
        "unusual_location": unusual_location,
        "security_concern": security_concern,
        "risk_score": risk_assessment["score"],
        "risk_level_v2": risk_assessment["level"],
        "risk_factors": risk_assessment["factors"],
    }

def calculate_process_risk(
    process,
    unusual_location,
    high_resource,
):
    """
    Calculate an explainable investigation-priority score.

    This score is NOT a probability that the process is malware.
    """

    score = 0
    factors = []

    name = (process.get("name") or "").lower()
    executable = process.get("executable")
    parent_name = process.get("parent_name")
    username = process.get("username")

    if unusual_location:
        score += 40
        factors.append({
            "reason": "Executable is located in a temporary directory.",
            "points": 40,
        })

    if high_resource:
        score += 20
        factors.append({
            "reason": "Sustained high CPU or memory usage was detected.",
            "points": 20,
        })

    if not executable:
        score += 5
        factors.append({
            "reason": (
                "Executable location could not be verified. "
                "This may be caused by operating system restrictions."
            ),
            "points": 5,
        })
    if not parent_name:
        score += 5
        factors.append({
            "reason": "Parent process information is unavailable.",
            "points": 5,
        })

    if not username:
        score += 5
        factors.append({
            "reason": "Process ownership information is unavailable.",
            "points": 5,
        })

    sensitive_names = {
        "svchost.exe",
        "lsass.exe",
        "services.exe",
        "winlogon.exe",
        "explorer.exe",
        "powershell.exe",
        "cmd.exe",
        "launchd",
        "loginwindow",
    }

    if name in sensitive_names and unusual_location:
        score += 30
        factors.append({
            "reason": (
                "A process using a sensitive system name "
                "is running from a temporary directory."
            ),
            "points": 30,
        })

    score = min(score, 100)

    if score >= 70:
        level = "high"
    elif score >= 30:
        level = "moderate"
    else:
        level = "low"

    return {
        "score": score,
        "level": level,
        "factors": factors,
    }

def analyze_processes(processes):
    analyzed = []
    active_identities = set()

    for process in processes:
        identity = (
            process.get("pid"),
            process.get("create_time")
        )
        active_identities.add(identity)

        result = analyze_process(process)

        analyzed.append({
            **process,
            "analysis": result,
        })

    for identity in list(_resource_history):
        if identity not in active_identities:
            del _resource_history[identity]

    high_risk = sum(
        1 for p in analyzed
        if p["analysis"]["risk_level_v2"] == "high"
    )

    moderate_risk = sum(
        1 for p in analyzed
        if p["analysis"]["risk_level_v2"] == "moderate"
    )

    return {
        "processes": analyzed,
        "summary": {
            "total": len(analyzed),
            "high_resource": sum(
                p["analysis"]["high_resource"]
                for p in analyzed
            ),
            "review_recommended": sum(
                p["analysis"]["review_recommended"]
                for p in analyzed
            ),
            "security_concerns": sum(
                p["analysis"]["security_concern"]
                for p in analyzed
            ),
            "high_risk": high_risk,
            "moderate_risk": moderate_risk,
        },
    }