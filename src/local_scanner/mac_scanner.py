
import subprocess


def run_command(command):
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


def check_gatekeeper():
    try:
        code, output = run_command(["spctl", "--status"])
        enabled = code == 0 and "assessments enabled" in output.lower()

        return {
            "status": "protected" if enabled else "warning",
            "details": (
                "macOS Gatekeeper is enabled."
                if enabled
                else f"Gatekeeper is disabled or could not be confirmed: {output}"
            ),
        }
    except Exception as exc:
        return {"status": "unknown", "details": str(exc)}


def check_firewall():
    try:
        code, output = run_command([
            "/usr/libexec/ApplicationFirewall/socketfilterfw",
            "--getglobalstate",
        ])

        if code != 0:
            return {"status": "unknown", "details": output}

        enabled = "enabled" in output.lower()

        return {
            "status": "protected" if enabled else "warning",
            "details": (
                "macOS Application Firewall is enabled."
                if enabled
                else "macOS Application Firewall is disabled."
            ),
        }
    except Exception as exc:
        return {"status": "unknown", "details": str(exc)}


def scan_mac():
    return {
        "antivirus": {
            "status": "unknown",
            "details": (
                "Third-party antivirus detection is not implemented. "
                "Gatekeeper status is reported separately."
            ),
        },
        "firewall": check_firewall(),
        "gatekeeper": check_gatekeeper(),
        "threats": {
            "status": "not_scanned",
            "details": "No malware scan has been performed.",
        },
    }