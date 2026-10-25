import { useEffect, useState } from "react";
import {
  Monitor,
  ShieldCheck,
  Flame,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Clock3,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";

import "./DeviceScanner.css";

type ScanStatus = "checking" | "ready" | "unavailable" | "scanning";
type PanelType = "antivirus" | "firewall" | "threats";

type AntivirusProvider = {
  name: string;
  active: boolean;
  product_state?: number;
};

type FirewallProfile = {
  name: string;
  enabled: boolean;
};

type CheckResult = {
  status: string;
  details: string;
  providers?: AntivirusProvider[];
  profiles?: FirewallProfile[];
};

type SecurityResult = {
  antivirus: CheckResult;
  firewall: CheckResult;
  threats: CheckResult;
  gatekeeper?: CheckResult;
};

type MalwareResult = {
  status: string;
  details: string;
  elapsed_seconds?: number;
  duration_seconds?: number;
  current_file?: string | null;
  scanned_files?: number;
  infected_files?: number;
  total_errors?: number;
  scan_errors?: string[];
  threats?: string[];
  scan_folder?: string;
  scan_mode?: string;
  targets_count?: number;
};

type HealthResult = {
  status: string;
  operating_system: string;
  supported: boolean;
};

const SCANNER_URL = "http://127.0.0.1:8765";

function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    protected: "Protected",
    warning: "Warning",
    unknown: "Unknown",
    not_scanned: "Not Scanned",
    clean: "Clean",
    completed_with_errors: "Scan Errors",
    threats_found: "Threats Found",
    scanning: "Scanning",
    cancelled: "Cancelled",
  };

  return labels[status ?? ""] ?? "Not Checked";
}

function statusClass(status?: string) {
  if (status === "protected") return "protected";
  if (status === "warning" || status === "completed_with_errors" || status === "threats_found") return "warning";
  if (status === "clean") return "protected";
  return "neutral";
}

function DeviceScanner() {
  const [operatingSystem, setOperatingSystem] = useState("Detecting...");
  const [scanStatus, setScanStatus] = useState<ScanStatus>("unavailable");
  const [scanResults, setScanResults] = useState<SecurityResult | null>(null);
  const [expandedPanel, setExpandedPanel] = useState<PanelType | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [malware, setMalware] = useState<MalwareResult | null>(null);
  const [malwareError, setMalwareError] = useState("");
  const [malwareBusy, setMalwareBusy] = useState(false);
  const [scanMode, setScanMode] = useState<
    "quick" | "custom" | "full"
  >("quick");

  const [scanFolder, setScanFolder] = useState("");
  const [folderPicking, setFolderPicking] = useState(false);

  useEffect(() => {
    const platform = navigator.userAgent;

    if (/Windows/i.test(platform)) {
      setOperatingSystem("Windows Device");
    } else if (/Macintosh|Mac OS X/i.test(platform)) {
      setOperatingSystem("macOS Device");
    } else {
      setOperatingSystem("Unsupported Device");
    }
  }, []);

    useEffect(() => {
      let active = true;

      const detectScanner = async () => {
        setScanStatus("checking");
        setError("");

        try {
          const response = await fetch(`${SCANNER_URL}/health`);

          if (!response.ok) {
            throw new Error("Unable to connect to the local scanner.");
          }

          const data: HealthResult = await response.json();

          if (!data.supported) {
            throw new Error("This operating system is not supported.");
          }

          if (!active) return;

          setOperatingSystem(
            data.operating_system === "Darwin"
              ? "macOS Device"
              : "Windows Device"
          );

          setScanStatus("ready");

        } catch (err) {
          if (!active) return;

          setError(
            "Local scanner unavailable. Make sure the Python scanner is running."
          );
          setScanStatus("unavailable");
        }
      };

      void detectScanner();

      return () => {
        active = false;
      };
    }, []);

  const checkDevice = async () => {
    if (scanStatus !== "ready") return;

    setScanStatus("scanning");
    setError("");

    try {
      const response = await fetch(`${SCANNER_URL}/status`);

      if (!response.ok) {
        throw new Error("Unable to check device security.");
      }

      const data: SecurityResult = await response.json();

      setScanResults(data);
      setLastChecked(new Date());
      setScanStatus("ready");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Security check failed."
      );
      setScanStatus("unavailable");
    }
  };

  useEffect(() => {
    if (scanStatus !== "ready") return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `${SCANNER_URL}/scan-malware/status`
        );
        if (!response.ok) return;
        const data: MalwareResult = await response.json();
        if (active) setMalware(data);
      } catch {
        // Device connection errors are handled separately.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [scanStatus,]);

  const chooseScanFolder = async () => {
    setMalwareError("");
    setFolderPicking(true);

    try {
      const response = await fetch(`${SCANNER_URL}/choose-folder`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Unable to open folder picker.");
      }

      const data: {
        status: string;
        path: string | null;
      } = await response.json();

      if (data.status === "selected" && data.path) {
        setScanFolder(data.path);
      }
    } catch (err) {
      setMalwareError(
        err instanceof Error ? err.message : "Folder selection failed."
      );
    } finally {
      setFolderPicking(false);
    }
  };

  const startMalwareScan = async () => {
    setMalwareError("");
    setMalwareBusy(true);
    try {
      const response = await fetch(`${SCANNER_URL}/scan-malware`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: scanMode,
          folder: scanFolder,
        }),
      });
      if (!response.ok) throw new Error("Unable to start malware scan.");
      const data: MalwareResult = await response.json();
      setMalware(data);
      if (data.status === "error") setMalwareError(data.details);
    } catch (err) {
      setMalwareError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setMalwareBusy(false);
    }
  };

  const cancelMalwareScan = async () => {
    setMalwareError("");
    try {
      const response = await fetch(`${SCANNER_URL}/scan-malware/cancel`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Unable to cancel malware scan.");
      setMalware({ ...(malware ?? { details: "" }), status: "cancelling", details: "Cancelling scan..." });
    } catch (err) {
      setMalwareError(err instanceof Error ? err.message : "Cancellation failed.");
    }
  };

  const togglePanel = (panel: PanelType) => {
    setExpandedPanel((current) => (current === panel ? null : panel));
  };

  const antivirus = scanResults?.antivirus;
  const firewall = scanResults?.firewall;
  const threats = scanResults?.threats;

  const panels = [
    {
      id: "antivirus" as PanelType,
      title: "Antivirus",
      subtitle: "Protection providers",
      result: antivirus,
      icon: <ShieldCheck size={27} />,
    },
    {
      id: "firewall" as PanelType,
      title: "Firewall",
      subtitle: "Network protection",
      result: firewall,
      icon: <Flame size={27} />,
    },
    {
      id: "threats" as PanelType,
      title: "Threats",
      subtitle: "Malware detection",
      result: malware && malware.status !== "idle" ? malware : threats,
      icon: <AlertTriangle size={27} />,
    },
  ];

  return (
    <div className="device-scanner-page">
      <div className="device-scanner-header">
        <h1>Device Scanner</h1>
        <p>Monitor your device's security and protection status.</p>
      </div>

      <div className="device-card">
        <div className="device-card-top">
          <div className="device-icon">
            <Monitor size={30} />
          </div>

          <div className="device-info">
            <h2>{operatingSystem}</h2>
            <p>Local security monitoring and protection checks.</p>
          </div>

          <span className={`device-ready ${scanStatus}`}>
            {scanStatus === "checking" && "Connecting..."}
            {scanStatus === "ready" && "Scanner Connected"}
            {scanStatus === "unavailable" && "Not Connected"}
            {scanStatus === "scanning" && "Checking..."}
          </span>
        </div>

        <div className="scanner-actions">
          <button
            type="button"
            className="scan-device-button"
            onClick={checkDevice}
            disabled={scanStatus !== "ready"}
          >
            <ShieldCheck size={18} />
            {scanStatus === "scanning"
              ? "Checking Security..."
              : "Check Device Security"}
          </button>

          {lastChecked && (
            <span className="last-checked">
              <Clock3 size={15} />
              Last checked: {lastChecked.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        {error && (
          <p className="scanner-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="security-section-heading">
        <div>
          <h2 className="device-section-title">Security Overview</h2>
          <p>Click a card to view detailed security information.</p>
        </div>

        <button
          type="button"
          className="security-refresh-button"
          onClick={checkDevice}
          disabled={scanStatus !== "ready"}
        >
          <RefreshCw
            size={17}
            className={scanStatus === "scanning" ? "spinning" : ""}
          />
          Refresh
        </button>
      </div>

      <div className="device-status-grid">
        {panels.map((panel) => {
          const selected = expandedPanel === panel.id;

          return (
            <button
              type="button"
              key={panel.id}
              className={`device-status-card interactive ${
                selected ? "selected" : ""
              }`}
              onClick={() => togglePanel(panel.id)}
              aria-expanded={selected}
              aria-controls="security-detail-panel"
            >
              <div className="status-card-top">
                <span className="status-card-icon">{panel.icon}</span>
                <span
                  className={`status-pill ${statusClass(
                    panel.result?.status
                  )}`}
                >
                  {statusLabel(panel.result?.status)}
                </span>
              </div>

              <h3>{panel.title}</h3>
              <p>{panel.subtitle}</p>

              <div className="status-card-footer">
                <span>{selected ? "Hide Details" : "View Details"}</span>
                {selected ? (
                  <ChevronUp size={18} />
                ) : (
                  <ChevronDown size={18} />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {expandedPanel && (
        <div
          className="security-detail-panel"
          id="security-detail-panel"
          key={expandedPanel}
        >
          {expandedPanel === "antivirus" && (
            <>
              <div className="detail-header">
                <div>
                  <h2>Antivirus Protection</h2>
                  <p>Security providers registered on this device.</p>
                </div>
                <span className={`status-pill ${statusClass(antivirus?.status)}`}>
                  {statusLabel(antivirus?.status)}
                </span>
              </div>

              {antivirus?.providers?.length ? (
                <div className="provider-list">
                  {antivirus.providers.map((provider, index) => (
                    <div className="provider-row" key={`${provider.name}-${index}`}>
                      <div className="provider-name">
                        {provider.active ? (
                          <CheckCircle2 size={21} className="success-icon" />
                        ) : (
                          <XCircle size={21} className="muted-icon" />
                        )}
                        <div>
                          <strong>{provider.name}</strong>
                          <p>
                            {provider.active
                              ? "Reported as active by Windows Security Center"
                              : "Not currently reported as active"}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`status-pill ${
                          provider.active ? "protected" : "neutral"
                        }`}
                      >
                        {provider.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="detail-empty">
                  <Info size={20} />
                  <p>
                    {antivirus?.details ??
                      "Run a security check to view antivirus providers."}
                  </p>
                </div>
              )}

              {antivirus?.providers?.length ? (
                <div className="detail-info">
                  <Info size={18} />
                  <p>{antivirus.details}</p>
                </div>
              ) : null}
            </>
          )}

          {expandedPanel === "firewall" && (
            <>
              <div className="detail-header">
                <div>
                  <h2>Firewall Protection</h2>
                  <p>Review the firewall configuration on your device.</p>
                </div>
                <span className={`status-pill ${statusClass(firewall?.status)}`}>
                  {statusLabel(firewall?.status)}
                </span>
              </div>

              {firewall?.profiles?.length ? (
                <div className="provider-list">
                  {firewall.profiles.map((profile) => (
                    <div className="provider-row" key={profile.name}>
                      <div className="provider-name">
                        {profile.enabled ? (
                          <CheckCircle2 size={21} className="success-icon" />
                        ) : (
                          <AlertTriangle size={21} className="warning-icon" />
                        )}
                        <div>
                          <strong>{profile.name} Network</strong>
                          <p>Windows Firewall profile</p>
                        </div>
                      </div>
                      <span
                        className={`status-pill ${
                          profile.enabled ? "protected" : "warning"
                        }`}
                      >
                        {profile.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="detail-empty">
                  <Flame size={22} />
                  <p>
                    {firewall?.details ??
                      "Run a security check to view firewall information."}
                  </p>
                </div>
              )}

              {firewall?.profiles?.length ? (
                <div className="detail-info">
                  <Info size={18} />
                  <p>{firewall.details}</p>
                </div>
              ) : null}
            </>
          )}

          {expandedPanel === "threats" && (
            <>
              <div className="detail-header">
                <div>
                  <h2>Threat Detection</h2>
                  <p>Malware scan information and detection status.</p>
                </div>
                <span className={`status-pill ${statusClass(malware && malware.status !== "idle" ? malware.status : threats?.status)}`}>
                  {statusLabel(malware && malware.status !== "idle" ? malware.status : threats?.status)}
                </span>
              </div>

              <div className="threat-empty-state">
                <AlertTriangle size={34} />
                <h3>
                  {malware?.status === "scanning"
                    ? `Running ${
                        malware.scan_mode
                          ? malware.scan_mode.charAt(0).toUpperCase() +
                            malware.scan_mode.slice(1)
                          : "Malware"
                      } Scan...`
                    : "Malware Scanner"}
                </h3>
                <p>{malware?.details ?? threats?.details ?? "No malware scan performed."}</p>
                <div className="scan-mode-selection">
                  <h3>Select Scan Type</h3>

                  <div className="scan-mode-options">
                    <label>
                      <input
                        type="radio"
                        name="scanMode"
                        value="quick"
                        checked={scanMode === "quick"}
                        onChange={() => setScanMode("quick")}
                        disabled={
                          malware?.status === "scanning" ||
                          malware?.status === "cancelling"
                        }
                      />
                      Quick Scan
                    </label>

                    <label>
                      <input
                        type="radio"
                        name="scanMode"
                        value="custom"
                        checked={scanMode === "custom"}
                        onChange={() => setScanMode("custom")}
                        disabled={
                          malware?.status === "scanning" ||
                          malware?.status === "cancelling"
                        }
                      />
                      Custom Scan
                    </label>

                    <label>
                      <input
                        type="radio"
                        name="scanMode"
                        value="full"
                        checked={scanMode === "full"}
                        onChange={() => setScanMode("full")}
                        disabled={
                          malware?.status === "scanning" ||
                          malware?.status === "cancelling"
                        }
                      />
                      Full Scan
                    </label>
                  </div>

                  {scanMode === "custom" && (
                  <div className="scan-folder-selection">
                    <button
                      type="button"
                      onClick={chooseScanFolder}
                      disabled={
                        scanStatus !== "ready" ||
                        folderPicking ||
                        malware?.status === "scanning" ||
                        malware?.status === "cancelling"
                      }
                    >
                      {folderPicking ? "Opening Folder Picker..." : "Browse Folders"}
                    </button>

                    <p>
                      {scanFolder
                        ? `Selected folder: ${scanFolder}`
                        : "No folder selected."}
                    </p>
                  </div>
                )}

                  <p className="scan-mode-description">
                    {scanMode === "quick" &&
                      "Scans files directly in Downloads and Desktop up to 100 MB. Subfolders and larger files are skipped."}

                    {scanMode === "custom" &&
                      "Scans the selected folder and its subfolders."}

                    {scanMode === "full" &&
                      "Scans accessible files in your home directory. This may take a long time and is not a complete system-wide scan."}
                  </p>
                </div>
                {malware?.status === "scanning" || malware?.status === "cancelling" ? (
                  <div className="malware-live" role="status">
                    <div className="malware-indeterminate"><span /></div>
                    <p>Elapsed: {Math.floor((malware.elapsed_seconds ?? 0) / 60)}m {Math.floor((malware.elapsed_seconds ?? 0) % 60)}s</p>
                    <p className="malware-current-file">{malware.current_file ? `Current file: ${malware.current_file}` : "Loading signatures or preparing files..."}</p>
                    <p>Progress is ongoing; an exact percentage is not available.</p>
                  </div>
                ) : null}
                {malware && ["clean", "completed_with_errors", "threats_found"].includes(malware.status) && (
                  <div className="malware-results">
                    <p>Scanned files: {malware.scanned_files ?? "—"}</p>
                    <p>Infected files: {malware.infected_files ?? "—"}</p>
                    <p>Scan errors: {malware.total_errors ?? "—"}</p>
                    <p>Duration: {malware.duration_seconds ?? "—"} seconds</p>
                    {Boolean(malware.scan_errors?.length) && <div><strong>Files with errors:</strong><ul>{malware.scan_errors!.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
                    {Boolean(malware.threats?.length) && <div><strong>Threat detections:</strong><ul>{malware.threats!.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
                  </div>
                )}
                {malwareError && <p className="scanner-error" role="alert">{malwareError}</p>}
                {malware?.status === "scanning" || malware?.status === "cancelling" ? (
                  <button type="button" className="scan-device-button" onClick={cancelMalwareScan} disabled={malware.status === "cancelling"}>Cancel Scan</button>
                ) : (
                  <button type="button" className="scan-device-button" onClick={startMalwareScan} disabled={
                    scanStatus !== "ready" ||
                    malwareBusy ||
                    folderPicking ||
                    (scanMode === "custom" && !scanFolder)
                  }>Run Malware Scan</button>
                )}
              </div>

              <div className="detail-info">
                <Info size={18} />
                <p>
                  Checking antivirus and firewall settings does not
                  establish whether your device contains malware.
                </p>
              </div>
            </>
          )}

          {scanResults?.gatekeeper && (
            <div className="detail-info">
              <ShieldCheck size={18} />
              <p>
                macOS Gatekeeper:{" "}
                {statusLabel(scanResults.gatekeeper.status)} —{" "}
                {scanResults.gatekeeper.details}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DeviceScanner;