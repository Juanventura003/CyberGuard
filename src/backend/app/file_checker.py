import hashlib
import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SUSPICIOUS_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".scr", ".ps1", ".vbs", ".js", ".msi"
}

FILE_SIGNATURES = {
    ".pdf": [b"%PDF-"],
    ".jpg": [b"\xff\xd8\xff"],
    ".png": [b"\x89PNG\r\n\x1a\n"],
    ".gif": [b"GIF87a", b"GIF89a"],
    ".zip": [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"],
    ".exe": [b"MZ"],
}

OFFICE_EXTENSIONS = {".docx", ".xlsx", ".pptx"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def is_webp(contents: bytes):
    return (
        len(contents) >= 12
        and contents[:4] == b"RIFF"
        and contents[8:12] == b"WEBP"
    )


def detect_file_type(contents: bytes):
    if is_webp(contents):
        return ".webp"

    for extension, signatures in FILE_SIGNATURES.items():
        if any(contents.startswith(signature) for signature in signatures):
            return extension

    return None


def check_file_signature(filename: str, contents: bytes):
    extension = Path(filename).suffix.lower()
    detected_type = detect_file_type(contents)

    if extension in OFFICE_EXTENSIONS:
        expected_type = ".zip"
    elif extension == ".jpeg":
        expected_type = ".jpg"
    elif extension == ".dll":
        expected_type = ".exe"
    else:
        expected_type = extension

    supported = (
        set(FILE_SIGNATURES)
        | OFFICE_EXTENSIONS
        | {".jpeg", ".dll", ".webp"}
    )

    if detected_type is None:
        if extension in supported:
            return {
                "status": "MISMATCH",
                "detected_type": "UNKNOWN",
                "reason": (
                    f"The contents do not match the expected "
                    f"{extension} file signature."
                ),
            }

        return {
            "status": "UNSUPPORTED",
            "detected_type": "UNKNOWN",
            "reason": (
                "File signature verification is not available "
                "for this file type."
            ),
        }

    if detected_type == expected_type:
        return {
            "status": "MATCH",
            "detected_type": detected_type,
            "reason": "The file signature matches its extension.",
        }

    return {
        "status": "MISMATCH",
        "detected_type": detected_type,
        "reason": (
            f"The file extension is {extension}, but the "
            f"contents appear to be {detected_type}."
        ),
    }


def check_virustotal(sha256: str):
    api_key = os.getenv("VIRUSTOTAL_API_KEY")

    if not api_key:
        raise RuntimeError("VirusTotal API key is not configured.")

    try:
        response = requests.get(
            f"https://www.virustotal.com/api/v3/files/{sha256}",
            headers={"x-apikey": api_key},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise RuntimeError(
            "Unable to connect to VirusTotal."
        ) from exc

    if response.status_code == 404:
        return {
            "status": "UNKNOWN",
            "malicious": 0,
            "suspicious": 0,
            "total": 0,
        }

    if response.status_code == 429:
        raise RuntimeError(
            "VirusTotal rate limit reached. Try again later."
        )

    if response.status_code in (401, 403):
        raise RuntimeError(
            "VirusTotal API key was rejected or lacks permission."
        )

    if not response.ok:
        raise RuntimeError(
            f"VirusTotal returned HTTP {response.status_code}."
        )

    stats = response.json()["data"]["attributes"]["last_analysis_stats"]

    return {
        "status": "FOUND",
        "malicious": stats.get("malicious", 0),
        "suspicious": stats.get("suspicious", 0),
        "total": sum(stats.values()),
    }


def check_defender(contents: bytes):
    """Scan file bytes using Microsoft Defender on Windows."""

    if platform.system() != "Windows":
        return {
            "status": "UNAVAILABLE",
            "reason": "Microsoft Defender is only used on Windows.",
        }

    defender_path = Path(
        r"C:\Program Files\Windows Defender\MpCmdRun.exe"
    )

    if not defender_path.exists():
        platform_dir = Path(
            r"C:\ProgramData\Microsoft\Windows Defender\Platform"
        )

        candidates = sorted(
            platform_dir.glob("*/MpCmdRun.exe"),
            reverse=True,
        )

        if candidates:
            defender_path = candidates[0]
        else:
            return {
                "status": "UNAVAILABLE",
                "reason": "Microsoft Defender scanner was not found.",
            }

    try:
        with tempfile.TemporaryDirectory(
            prefix="cyberguard_defender_"
        ) as temp_dir:

            file_path = Path(temp_dir) / "upload.bin"
            file_path.write_bytes(contents)

            result = subprocess.run(
                [
                    str(defender_path),
                    "-Scan",
                    "-ScanType",
                    "3",
                    "-File",
                    str(file_path),
                ],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=120,
                check=False,
            )

            output = (
                result.stdout + "\n" + result.stderr
            ).lower()

            if (
                result.returncode == 0
                and "found no threats" in output
            ):
                return {
                    "status": "CLEAN",
                    "reason": (
                        "Microsoft Defender found no known threats."
                    ),
                }

            if any(
                phrase in output
                for phrase in (
                    "found threats",
                    "threat found",
                    "threats found",
                )
            ):
                return {
                    "status": "INFECTED",
                    "reason": (
                        "Microsoft Defender detected a potential threat."
                    ),
                }

            return {
                "status": "ERROR",
                "reason": (
                    "Microsoft Defender could not confirm a clean "
                    f"scan (exit code {result.returncode})."
                ),
            }

    except subprocess.TimeoutExpired:
        return {
            "status": "ERROR",
            "reason": "Microsoft Defender scan timed out.",
        }

    except OSError:
        return {
            "status": "ERROR",
            "reason": (
                "Microsoft Defender scan could not be started."
            ),
        }


def check_clamav(contents: bytes):
    """Scan file bytes using locally installed ClamAV."""

    scanner = shutil.which("clamscan")

    if not scanner:
        return {
            "status": "UNAVAILABLE",
            "reason": (
                "ClamAV is not installed or clamscan is not in PATH. "
                "Install and initialize ClamAV to enable local scanning."
            ),
        }

    try:
        with tempfile.TemporaryDirectory(
            prefix="cyberguard_clamav_"
        ) as temp_dir:

            file_path = Path(temp_dir) / "upload.bin"
            file_path.write_bytes(contents)

            result = subprocess.run(
                [
                    scanner,
                    "--no-summary",
                    "--stdout",
                    str(file_path),
                ],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=120,
                check=False,
            )

            if result.returncode == 0:
                return {
                    "status": "CLEAN",
                    "reason": "ClamAV found no known threats.",
                }

            if result.returncode == 1:
                return {
                    "status": "INFECTED",
                    "reason": (
                        "ClamAV detected a potential threat."
                    ),
                }

            return {
                "status": "ERROR",
                "reason": (
                    "ClamAV could not complete the scan. "
                    "Check that its virus database is initialized "
                    "and updated."
                ),
            }

    except subprocess.TimeoutExpired:
        return {
            "status": "ERROR",
            "reason": "ClamAV scan timed out.",
        }

    except OSError:
        return {
            "status": "ERROR",
            "reason": "ClamAV scan could not be started.",
        }


def check_file(filename: str, contents: bytes):
    """Analyze an uploaded file and return a risk assessment."""

    sha256 = hashlib.sha256(contents).hexdigest()
    extension = Path(filename).suffix.lower()

    risk_score = 0
    reasons = []

    # 1. Check suspicious extensions
    if extension in SUSPICIOUS_EXTENSIONS:
        risk_score += 30
        reasons.append(
            f"The file uses the potentially risky "
            f"{extension} file type."
        )

    if not contents:
        risk_score += 20
        reasons.append("The file is empty.")

    # 2. Verify file signature
    signature_result = check_file_signature(
        filename,
        contents,
    )

    if signature_result["status"] == "MISMATCH":
        detected_type = signature_result["detected_type"]

        if (
            extension in IMAGE_EXTENSIONS
            and detected_type in IMAGE_EXTENSIONS
        ):
            risk_score += 10
            reasons.append(
                "The file contains a different image format "
                "than its extension suggests."
            )
        else:
            risk_score += 40
            reasons.append(signature_result["reason"])
    else:
        reasons.append(signature_result["reason"])

    # 3. Select antivirus based on backend operating system
    defender_result = {
        "status": "UNAVAILABLE",
        "reason": "Microsoft Defender was not selected.",
    }

    clamav_result = {
        "status": "UNAVAILABLE",
        "reason": "ClamAV was not selected.",
    }

    if platform.system() == "Windows":
        defender_result = check_defender(contents)

        if defender_result["status"] in (
            "UNAVAILABLE",
            "ERROR",
        ):
            clamav_result = check_clamav(contents)

    else:
        # macOS and Linux
        clamav_result = check_clamav(contents)

    # 4. Evaluate antivirus results
    for result in (defender_result, clamav_result):
        if result["reason"] in (
            "Microsoft Defender was not selected.",
            "ClamAV was not selected.",
        ):
            continue

        reasons.append(result["reason"])

        if result["status"] == "INFECTED":
            risk_score = max(risk_score, 95)

    # 5. VirusTotal hash lookup
    vt_result = check_virustotal(sha256)

    if vt_result["status"] == "FOUND":
        malicious = vt_result["malicious"]
        suspicious = vt_result["suspicious"]

        if malicious >= 5:
            risk_score = max(risk_score, 90)
            reasons.append(
                f"VirusTotal: {malicious} security engines "
                "flagged this file as malicious."
            )

        elif malicious >= 1 or suspicious >= 2:
            risk_score = max(risk_score, 60)
            reasons.append(
                f"VirusTotal: {malicious} malicious and "
                f"{suspicious} suspicious detections."
            )

        elif suspicious == 1:
            risk_score = max(risk_score, 40)
            reasons.append(
                "VirusTotal: One security engine flagged "
                "this file as suspicious."
            )

        else:
            reasons.append(
                "VirusTotal reported no malware detections."
            )

    else:
        reasons.append(
            "This file was not found in VirusTotal's database."
        )

    # 6. Determine final classification
    risk_score = min(risk_score, 100)

    antivirus_clean = any(
        result["status"] == "CLEAN"
        for result in (defender_result, clamav_result)
    )

    if risk_score > 70:
        classification = "HIGH RISK"

    elif risk_score > 30:
        classification = "SUSPICIOUS"

    elif antivirus_clean:
        classification = "SAFE"

    else:
        classification = "UNKNOWN"

    # 7. Return results to frontend
    return {
        "filename": filename,
        "file_size": len(contents),
        "sha256": sha256,
        "risk_score": risk_score,
        "classification": classification,
        "reasons": reasons,
        "signature": signature_result,
        "virustotal": vt_result,
        "defender": defender_result,
        "clamav": clamav_result,
    }