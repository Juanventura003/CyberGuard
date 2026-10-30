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


app = FastAPI(title="CyberGuard Local Scanner")

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

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)