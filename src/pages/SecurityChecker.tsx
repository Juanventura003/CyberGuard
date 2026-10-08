import { useState } from "react";
import {
  Link,
  FileText,
  KeyRound,
  Phone,
  Mail,
  Database,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import "./SecurityChecker.css";

type CheckerType = "link" | "file" | "password" | "phone" | "email" | "breach";

type LinkScanResult = {
  url: string;
  risk_score: number;
  classification: "SAFE" | "SUSPICIOUS" | "HIGH RISK";
  known_threat: boolean;
  threat_types: string[];
  reasons: string[];
};

function SecurityChecker() {
  const [activeChecker, setActiveChecker] =
    useState<CheckerType>("link");

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] =
    useState<LinkScanResult | null>(null);

  const handleCheckLink = async () => {
    const trimmedUrl = url.trim();

    // make sure a url was entered
    if (!trimmedUrl) {
      setUrlError("Please enter a URL.");
      return;
    }

    // see if url is true
    try {
      const parsedUrl = new URL(trimmedUrl);

      if (
        parsedUrl.protocol !== "http:" &&
        parsedUrl.protocol !== "https:"
      ) {
        setUrlError("Please enter a valid HTTP or HTTPS URL.");
        return;
      }
    } catch {
      setUrlError("Please enter a valid URL.");
      return;
    }

    setUrlError("");
    setIsScanning(true);
    setScanResult(null);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/security/link-check",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: trimmedUrl,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Unable to scan link.");
      }

      const data: LinkScanResult = await response.json();

      setScanResult(data);
    } catch (error) {
      console.error("Link scan error:", error);

      setUrlError(
        "Unable to scan this link. Please make sure the CyberGuard backend is running."
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanAnother = () => {
    setUrl("");
    setUrlError("");
    setScanResult(null);
  };

  const getResultIcon = () => {
    if (!scanResult) return null;

    if (scanResult.classification === "SAFE") {
      return <CheckCircle size={30} />;
    }

    if (scanResult.classification === "SUSPICIOUS") {
      return <AlertTriangle size={30} />;
    }

    return <XCircle size={30} />;
  };

  return (
    <div className="security-checker-page">
      <div className="security-checker-header">
        <h1>Security Checker</h1>
        <p>Check suspicious content before interacting with it.</p>
      </div>

      <div className="checker-options">
        {/* Link Checker */}
        <button
          className={`checker-option ${
            activeChecker === "link" ? "active" : ""
          }`}
          onClick={() => setActiveChecker("link")}
        >
          <div className="checker-option-icon">
            <Link size={24} />
          </div>

          <div>
            <h3>Link Checker</h3>
            <p>Check a URL before opening it.</p>
          </div>
        </button>

        {/* File Checker */}
        <button
          className={`checker-option ${
            activeChecker === "file" ? "active" : ""
          }`}
          onClick={() => setActiveChecker("file")}
        >
          <div className="checker-option-icon">
            <FileText size={24} />
          </div>

          <div>
            <h3>File Checker</h3>
            <p>Analyze a file for potential threats.</p>
          </div>
        </button>

        {/* Password Checker */}
        <button
          className={`checker-option ${
            activeChecker === "password" ? "active" : ""
          }`}
          onClick={() => setActiveChecker("password")}
        >
          <div className="checker-option-icon">
            <KeyRound size={24} />
          </div>

          <div>
            <h3>Password Checker</h3>
            <p>Check the strength of your password.</p>
          </div>
        </button>

        {/* Phone Checker */}
        <button
          className={`checker-option ${
            activeChecker === "phone" ? "active" : ""
          }`}
          onClick={() => setActiveChecker("phone")}
        >
          <div className="checker-option-icon">
            <Phone size={24} />
          </div>

          <div>
            <h3>Phone Number Checker</h3>
            <p>Check an unfamiliar phone number.</p>
          </div>
        </button>

        {/* Email Address Checker */}
        <button
          className={`checker-option email-checker-option ${
            activeChecker === "email" ? "active" : ""
          }`}
          onClick={() => setActiveChecker("email")}
        >
          <div className="checker-option-icon">
            <Mail size={24} />
          </div>

          <div>
            <h3>Email Address Checker</h3>
            <p>Check an unfamiliar email address.</p>
          </div>
        </button>

        {/* Data Breach Checker */}
        <button
          className={`checker-option breach-checker-option ${
            activeChecker === "breach" ? "active" : ""
          }`}
          onClick={() => setActiveChecker("breach")}
        >
          <div className="checker-option-icon">
            <Database size={24} />
          </div>

          <div>
            <h3>Data Breach Checker</h3>
            <p>Check if your email appears in known data breaches.</p>
          </div>
        </button>
      </div>

      {/* Link Checker */}
      {activeChecker === "link" && (
        <div className="checker-panel">
          <div className="checker-panel-title">
            <div className="checker-panel-icon">
              <Link size={22} />
            </div>

            <div>
              <h2>Link Checker</h2>
              <p>Check any link before visiting it.</p>
            </div>
          </div>

          {!scanResult && (
            <div className="link-checker-form">
              <label htmlFor="link-url">URL</label>

              <div className="link-input-row">
                <input
                  id="link-url"
                  type="text"
                  placeholder="https://example.com"
                  value={url}
                  disabled={isScanning}
                  onChange={(event) => {
                    setUrl(event.target.value);

                    if (urlError) {
                      setUrlError("");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !isScanning
                    ) {
                      handleCheckLink();
                    }
                  }}
                />

                <button
                  className="check-link-button"
                  onClick={handleCheckLink}
                  disabled={!url.trim() || isScanning}
                >
                  {isScanning ? "Scanning..." : "Check Link"}
                </button>
              </div>

              {urlError && (
                <p className="link-error-message">
                  {urlError}
                </p>
              )}
            </div>
          )}

          {/* Scan Result */}
          {scanResult && (
            <div
              className={`link-scan-result ${scanResult.classification
                .toLowerCase()
                .replace(" ", "-")}`}
            >
              <div className="result-status">
                <div className="result-icon">
                  {getResultIcon()}
                </div>

                <div>
                  <p className="result-label">Scan Result</p>

                  <h2>{scanResult.classification}</h2>
                </div>
              </div>

              <div className="result-url">
                <span>Scanned URL</span>
                <p>{scanResult.url}</p>
              </div>

              <div className="risk-score-section">
                <div className="risk-score-heading">
                  <span>Risk Score</span>

                  <strong>
                    {scanResult.risk_score} / 100
                  </strong>
                </div>

                <div className="risk-score-track">
                  <div
                    className="risk-score-fill"
                    style={{
                      width: `${scanResult.risk_score}%`,
                    }}
                  />
                </div>
              </div>

              <div className="result-reasons">
                <h3>Analysis</h3>

                <ul>
                  {scanResult.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>

              <button
                className="scan-another-button"
                onClick={handleScanAnother}
              >
                Scan Another Link
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SecurityChecker;