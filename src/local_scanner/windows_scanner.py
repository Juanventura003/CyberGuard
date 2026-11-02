
import json
import subprocess


def run_powershell(command, timeout=30):
    result = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            command,
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )

    if result.returncode != 0:
        raise RuntimeError(
            result.stderr.strip() or "PowerShell command failed"
        )

    return result.stdout.strip()


def check_antivirus():
    """
    Detect antivirus products registered with Windows Security Center.
    Supports Defender, McAfee, Norton, and other registered providers.
    """

    command = """
    Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct |
    Select-Object displayName, productState |
    ConvertTo-Json -Compress
    """

    try:
        output = run_powershell(command)

        if not output:
            return {
                "status": "warning",
                "details": "No antivirus products were reported by Windows Security Center.",
                "providers": [],
            }

        products = json.loads(output)

        if isinstance(products, dict):
            products = [products]

        providers = []

        for product in products:
            name = product.get("displayName", "Unknown Antivirus")
            raw_state = int(product.get("productState", 0))

            # Windows Security Center encodes product status in
            # the middle byte of productState.
            state_byte = (raw_state >> 8) & 0xFF

            # Common active states reported by Windows Security Center.
            active = state_byte in (0x10, 0x11)

            providers.append({
                "name": name,
                "active": active,
                "product_state": raw_state,
            })

        active_providers = [
            provider for provider in providers
            if provider["active"]
        ]

        if active_providers:
            names = ", ".join(
                provider["name"] for provider in active_providers
            )

            return {
                "status": "protected",
                "details": f"Active antivirus detected: {names}",
                "providers": providers,
            }

        return {
            "status": "warning",
            "details": "No active antivirus provider was confirmed.",
            "providers": providers,
        }

    except Exception as exc:
        return {
            "status": "unknown",
            "details": f"Unable to check antivirus providers: {exc}",
            "providers": [],
        }



def check_firewall():
    try:
        output = run_powershell(
            "Get-NetFirewallProfile | "
            "Select-Object Name, Enabled | ConvertTo-Json -Compress"
        )

        profiles = json.loads(output)

        if isinstance(profiles, dict):
            profiles = [profiles]

        if not profiles:
            return {
                "status": "unknown",
                "details": "No Windows Firewall profiles were returned.",
                "profiles": [],
            }

        profile_results = []

        for profile in profiles:
            raw_enabled = profile.get("Enabled")
            enabled = (
                str(raw_enabled).strip().lower() in ("true", "1")
            )

            profile_results.append({
                "name": profile.get("Name", "Unknown"),
                "enabled": enabled,
            })

        all_enabled = all(
            profile["enabled"] for profile in profile_results
        )

        return {
            "status": "protected" if all_enabled else "warning",
            "details": (
                "All Windows Firewall profiles are enabled."
                if all_enabled
                else "One or more Windows Firewall profiles are disabled."
            ),
            "profiles": profile_results,
        }

    except Exception as exc:
        return {
            "status": "unknown",
            "details": str(exc),
            "profiles": [],
        }

def scan_windows():
    return {
        "antivirus": check_antivirus(),
        "firewall": check_firewall(),
        "threats": {
            "status": "not_scanned",
            "details": "Malware scan has not been performed.",
        },
    }