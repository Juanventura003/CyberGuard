import os
import subprocess
import threading
from pathlib import Path
import platform
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from windows_scanner import scan_windows
from mac_scanner import scan_mac
from malware_scanner import start_scan, scan_status, cancel_scan
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from system_guardian import (
    get_system_stats,
    get_running_processes,
    get_process_details,
)
from process_analysis import analyze_processes

from pydantic import BaseModel
from process_termination import (
    check_termination_eligibility,
    terminate_eligible_process,
    check_application_termination,
    terminate_application,
)
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from security_timeline import (
    update_process_timeline,
    get_security_events,
    record_process_termination,
)

from process_network import get_process_network_connections

app = FastAPI(title="CyberGuard Local Scanner")

process_executor = ThreadPoolExecutor(max_workers=1)
process_cache_lock = Lock()
process_cache = {
    "data": None,
    "scanning": False,
    "last_updated": None,
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["127.0.0.1", "localhost"],
)

ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}

def require_local_frontend(
    origin: str | None = Header(default=None),
):
    if origin not in ALLOWED_ORIGINS:
        raise HTTPException(
            status_code=403,
            detail="Request must come from the CyberGuard frontend."
        )

@app.get("/health")
def health(_=Depends(require_local_frontend)):
    system = platform.system()
    print("Detected operating system:", repr(system))
    return {"status": "ready", "operating_system": system,
            "supported": system in ("Windows", "Darwin")}

@app.get("/status")
def security_status(_=Depends(require_local_frontend)):
    system = platform.system()
    if system == "Windows":
        return scan_windows()
    if system == "Darwin":
        return scan_mac()
    raise HTTPException(status_code=501, detail=f"Unsupported operating system: {system}")

class ScanRequest(BaseModel):
    mode: str = "quick"
    folder: str = "downloads"
class FolderRequest(BaseModel):
    path: str


@app.post("/choose-folder")
def choose_folder(_=Depends(require_local_frontend)):

    system = platform.system()

    if system == "Windows":
        script = """
        Add-Type -AssemblyName System.Windows.Forms

        $form = New-Object System.Windows.Forms.Form
        $form.TopMost = $true
        $form.ShowInTaskbar = $false
        $form.StartPosition = 'CenterScreen'
        $form.Size = New-Object System.Drawing.Size(1,1)
        $form.Opacity = 0

        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = 'Select a folder to scan with CyberGuard'
        $dialog.ShowNewFolderButton = $false

        try {
            $form.Show()
            $form.Activate()

            if ($dialog.ShowDialog($form) -eq 'OK') {
                Write-Output $dialog.SelectedPath
            }
        }
        finally {
            $form.Close()
            $form.Dispose()
            $dialog.Dispose()
        }
        """
        result = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", script],
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail="Unable to open folder picker."
            )

        selected = result.stdout.strip()

    elif system == "Darwin":
        result = subprocess.run(
            [
                "osascript",
                "-e",
                'POSIX path of (choose folder with prompt "Select a folder to scan with CyberGuard")'
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )

        selected = result.stdout.strip() if result.returncode == 0 else ""

    else:
        raise HTTPException(
            status_code=501,
            detail="Unsupported operating system."
        )

    if not selected:
        return {"status": "cancelled", "path": None}

    path = Path(selected).resolve()

    if not path.is_dir():
        raise HTTPException(
            status_code=400,
            detail="Selected folder does not exist."
        )

    return {
        "status": "selected",
        "path": str(path)
    }

@app.post("/scan-malware")
def start_malware_scan(
    request: ScanRequest,
    _=Depends(require_local_frontend),
):
    return start_scan(
        mode=request.mode,
        folder=request.folder,
    )

@app.get("/scan-malware/status")
def malware_scan_status(_=Depends(require_local_frontend)):
    return scan_status()


@app.post("/scan-malware/cancel")
def cancel_malware_scan(_=Depends(require_local_frontend)):
    return cancel_scan()

@app.get("/system/stats")
def system_stats(_=Depends(require_local_frontend)):
    try:
        return get_system_stats()
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve system performance information."
        )

def refresh_process_cache():
    try:
        start = time.perf_counter()

        result = get_running_processes()
        analyzed = analyze_processes(result["processes"])
        
        update_process_timeline(analyzed["processes"])

        with process_cache_lock:
            process_cache["data"] = analyzed
            process_cache["last_updated"] = time.time()

        print(
            f"[CyberGuard] Process cache refreshed in "
            f"{time.perf_counter() - start:.2f} seconds",
            flush=True,
        )

    except Exception:
        import logging
        logging.exception("Process cache refresh failed")

    finally:
        with process_cache_lock:
            process_cache["scanning"] = False

@app.get("/system/processes")
def system_processes(_=Depends(require_local_frontend)):
    with process_cache_lock:
        cached = process_cache["data"]
        last_updated = process_cache["last_updated"]

        if not process_cache["scanning"]:
            process_cache["scanning"] = True

            try:
                process_executor.submit(refresh_process_cache)
            except RuntimeError:
                process_cache["scanning"] = False

        scanning = process_cache["scanning"]

    if cached is None:
        return {
            "processes": [],
            "summary": {
                "total": 0,
                "high_resource": 0,
                "review_recommended": 0,
                "security_concerns": 0,
                "high_risk": 0,
                "moderate_risk": 0,
            },
            "scanning": scanning,
            "last_updated": None,
        }

    return {
        **cached,
        "scanning": scanning,
        "last_updated": last_updated,
    }

@app.get("/system/security-events")
def system_security_events(
    _=Depends(require_local_frontend),
):
    return get_security_events(limit=100)


@app.get("/system/network-connections")
def system_network_connections(
    _=Depends(require_local_frontend),
):
    try:
        return get_process_network_connections()
    except Exception:
        import logging
        logging.exception("Network collection failed")

        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve network connections.",
        )

@app.get("/system/processes/{pid}")
def system_process_details(
    pid: int,
    _=Depends(require_local_frontend)
):
    result = get_process_details(pid)

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Process not found or access denied."
        )

    return result

class TerminationRequest(BaseModel):
    pid: int
    create_time: float

@app.post("/system/processes/termination-check")
def system_check_process_termination(
    request: TerminationRequest,
    _=Depends(require_local_frontend),
):
    return check_termination_eligibility(
        request.pid,
        request.create_time,
    )


@app.post("/system/processes/terminate")
def system_terminate_process(
    request: TerminationRequest,
    _=Depends(require_local_frontend),
):
    result = terminate_eligible_process(
        request.pid,
        request.create_time,
    )

    if result.get("success") and result.get("terminated"):
        record_process_termination(
            request.pid,
            result.get("name") or f"PID {request.pid}",
        )

    return result

@app.post("/system/processes/application-check")
def system_check_application_termination(
    request: TerminationRequest,
    _=Depends(require_local_frontend),
):
    return check_application_termination(
        request.pid,
        request.create_time,
    )


@app.post("/system/processes/terminate-application")
def system_terminate_application(
    request: TerminationRequest,
    _=Depends(require_local_frontend),
):
    result = terminate_application(
        request.pid,
        request.create_time,
    )

    for item in result.get("results", []):
        if item.get("success"):
            record_process_termination(
                item["pid"],
                item["name"],
            )

    return result

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)