
import subprocess
from pathlib import Path


def run_command(command):
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        return result.returncode, (
            result.stdout + "\n" + result.stderr
        ).strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return -1, str(exc)


def check_gatekeeper():
    code, output = run_command(["spctl", "--status"])
    normalized = output.lower()

    if code == 0 and "assessments enabled" in normalized:
        return {
            "status": "protected",
            "details": "macOS Gatekeeper is enabled.",
        }

    if "assessments disabled" in normalized:
        return {
            "status": "warning",
            "details": "macOS Gatekeeper is disabled.",
        }

    return {
        "status": "unknown",
        "details": f"Could not determine Gatekeeper status: {output}",
    }


def check_firewall():
    code, output = run_command([
        "/usr/libexec/ApplicationFirewall/socketfilterfw",
        "--getglobalstate",
    ])

    normalized = output.lower()

    if code != 0:
        return {"status": "unknown", "details": output}

    if "disabled" in normalized:
        return {
            "status": "warning",
            "details": "macOS Application Firewall is disabled.",
        }

    if "enabled" in normalized:
        return {
            "status": "protected",
            "details": "macOS Application Firewall is enabled.",
        }

    return {
        "status": "unknown",
        "details": f"Unexpected firewall response: {output}",
    }


def check_sip():
    code, output = run_command(["csrutil", "status"])
    normalized = output.lower()

    if code == 0 and "status: enabled" in normalized:
        return {
            "status": "protected",
            "details": "System Integrity Protection is enabled.",
        }

    if code == 0 and "status: disabled" in normalized:
        return {
            "status": "warning",
            "details": "System Integrity Protection is disabled.",
        }

    return {
        "status": "unknown",
        "details": f"Could not determine SIP status: {output}",
    }


def check_filevault():
    code, output = run_command(["fdesetup", "status"])
    normalized = output.lower()

    if code == 0 and "filevault is on" in normalized:
        return {
            "status": "protected",
            "details": "FileVault disk encryption is enabled.",
        }

    if code == 0 and "filevault is off" in normalized:
        return {
            "status": "warning",
            "details": "FileVault disk encryption is disabled.",
        }

    return {
        "status": "unknown",
        "details": f"Could not determine FileVault status: {output}",
    }


def check_xprotect():
    paths = [
        Path("/Library/Apple/System/Library/CoreServices/XProtect.bundle"),
        Path("/System/Library/CoreServices/XProtect.bundle"),
    ]

    if any(path.exists() for path in paths):
        return {
            "status": "protected",
            "details": (
                "XProtect components were found. "
                "This does not verify protection activity or update status."
            ),
        }

    return {
        "status": "unknown",
        "details": "Could not locate XProtect components.",
    }


def scan_mac():
    return {
        "antivirus": {
            "status": "unknown",
            "details": (
                "Third-party antivirus detection is not implemented. "
                "Gatekeeper and XProtect are checked separately."
            ),
        },
        "firewall": check_firewall(),
        "gatekeeper": check_gatekeeper(),
        "sip": check_sip(),
        "filevault": check_filevault(),
        "xprotect": check_xprotect(),
        "threats": {
            "status": "not_scanned",
            "details": "No malware scan has been performed.",
        },
    }