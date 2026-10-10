import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
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
  UploadCloud,
} from "lucide-react";

import "./SecurityChecker.css";
import GmailAttachmentPicker from "../components/GmailAttachmentPopup";

type CheckerType =
  | "link"
  | "file"
  | "password"
  | "phone"
  | "email"
  | "breach";

type LinkScanResult = {
  url: string;
  risk_score: number;
  classification: "SAFE" | "SUSPICIOUS" | "HIGH RISK";
  known_threat: boolean;
  threat_types: string[];
  reasons: string[];
};

type FileScanResult = {
  filename: string;
  file_size: number;
  sha256: string;
  risk_score: number;
  classification: "SAFE" | "SUSPICIOUS" | "HIGH RISK" | "UNKNOWN";
  reasons: string[];
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function SecurityChecker() {
  const [activeChecker, setActiveChecker] =
  useState<CheckerType>(() =>
    new URLSearchParams(window.location.search).get("checker") === "file"
      ? "file"
      : "link"
  );

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] =
    useState<LinkScanResult | null>(null);

  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [isFileScanning, setIsFileScanning] = useState(false);
  const [fileScanResult, setFileScanResult] =
    useState<FileScanResult | null>(null);

  const [fileSource, setFileSource] = useState<"device" | "gmail">("device");
  const [gmailSession, setGmailSession] = useState(
    () => sessionStorage.getItem("cyberguard_gmail_session") || ""
  );
  const [gmailPickerOpen, setGmailPickerOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const session = params.get("gmail_session");
    const error = params.get("gmail_error");
    const checker = params.get("checker");

    if (checker === "file" || session) {
      setActiveChecker("file");
    }

    if (session) {
      sessionStorage.setItem("cyberguard_gmail_session", session);
      setGmailSession(session);
      setActiveChecker("file");
      setFileSource("gmail");
      setGmailPickerOpen(true);
    }

    if (error) {
      setFileSource("gmail");
      setFileError(`Gmail connection failed: ${error}`);
    }

    if (session || error || checker) {
      params.delete("gmail_session");
      params.delete("gmail_error");
      params.delete("checker");

      const remaining = params.toString();

      window.history.replaceState(
        {},
        "",
        window.location.pathname +
          (remaining ? `?${remaining}` : "")
      );
    }
  }, []);

  const connectGmail = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}?checker=file`;
    window.location.assign(
      `http://127.0.0.1:8000/api/email/oauth/login?return_to=${encodeURIComponent(returnTo)}`
    );
  };

  const scanGmailAttachment = async (
    messageId: string,
    attachmentIndex: number
  ) => {
    setFileError("");
    setFileScanResult(null);
    setIsFileScanning(true);

    try {
      const params = new URLSearchParams({
        session: gmailSession,
        message_id: messageId,
        attachment_index: String(attachmentIndex),
      });

      const response = await fetch(
        `http://127.0.0.1:8000/api/security/gmail/scan-attachment?${params}`,
        { method: "POST" }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Attachment scan failed.");
      }

      const result: FileScanResult = await response.json();
      setFileScanResult(result);
      setGmailPickerOpen(false);
    } catch (error) {
      console.error("Gmail attachment scan error:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Unable to scan Gmail attachment.";

      setFileError(message);
      throw error;
    } finally {
      setIsFileScanning(false);
    }
  };
  const [isDragging, setIsDragging] = useState(false);

  const handleCheckLink = async () => {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setUrlError("Please enter a URL.");
      return;
    }

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


  const validateFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(null);
      setFileError("File must be 25 MB or smaller.");
      setFileScanResult(null);
      return;
    }

    setSelectedFile(file);
    setFileError("");
    setFileScanResult(null);
  };

  // Choose file using file picker
  const handleFileSelect = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) return;

    validateFile(file);

    // Allows selecting the same file again
    event.target.value = "";
  };

  // Dragging a file over the upload area
  const handleDragOver = (
    event: DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();

    if (isFileScanning) {
      event.dataTransfer.dropEffect = "none";
      return;
    }

    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  // Leaving the upload area
  const handleDragLeave = (
    event: DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();

    if (
      !event.currentTarget.contains(
        event.relatedTarget as Node | null
      )
    ) {
      setIsDragging(false);
    }
  };

  // Dropping a file into the upload area
  const handleFileDrop = (
    event: DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    setIsDragging(false);

    if (isFileScanning) return;

    const files = event.dataTransfer.files;

    if (files.length === 0) {
      setFileError(
        "Please drop a file from your device."
      );
      return;
    }

    if (files.length > 1) {
      setFileError("Please drop only one file at a time.");
      return;
    }

    validateFile(files[0]);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleCheckFile = async () => {
    if (!selectedFile) {
      setFileError("Please select a file.");
      return;
    }

    setFileError("");
    setIsFileScanning(true);
    setFileScanResult(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/security/file-check",
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        let errorMessage = "Unable to scan file.";

        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorMessage;
        } catch {
          // Use the default error message
        }

        throw new Error(errorMessage);
      }

      const data: FileScanResult = await response.json();
      setFileScanResult(data);
    } catch (error) {
      console.error("File scan error:", error);

      if (error instanceof Error) {
        setFileError(error.message);
      } else {
        setFileError("Unable to scan this file.");
      }
    } finally {
      setIsFileScanning(false);
    }
  };

  const handleScanAnotherFile = () => {
    setSelectedFile(null);
    setFileError("");
    setFileScanResult(null);
    setIsDragging(false);
  };

  const getFileResultIcon = () => {
    if (!fileScanResult) return null;

    if (fileScanResult.classification === "SAFE") {
      return <CheckCircle size={30} />;
    }

    if (
      fileScanResult.classification === "SUSPICIOUS" ||
      fileScanResult.classification === "UNKNOWN"
    ) {
      return <AlertTriangle size={30} />;
    }

    return <XCircle size={30} />;
  };


  return (
    <div className="security-checker-page">
      {/* Header */}
      <div className="security-checker-header">
        <h1>Security Checker</h1>
        <p>
          Check suspicious content before interacting with it.
        </p>
      </div>

      {/* Checker Options */}
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

        {/* Phone Number Checker */}
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
            <p>
              Check if your email appears in known data breaches.
            </p>
          </div>
        </button>
      </div>

      {/* LINK CHECKER*/}

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

          {/* Link Scan Result */}
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
                  {scanResult.reasons.map(
                    (reason, index) => (
                      <li key={index}>{reason}</li>
                    )
                  )}
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

      {/* FILE CHECKER*/}

      {activeChecker === "file" && (
        <div className="checker-panel">
          <div className="checker-panel-title">
            <div className="checker-panel-icon">
              <FileText size={22} />
            </div>

            <div>
              <h2>File Checker</h2>
              <p>
                Analyze a file for potential security threats.
              </p>
            </div>
          </div>

          {!fileScanResult && (
            <div className="file-source-options">
              <button
                type="button"
                className={`file-source-button ${fileSource === "device" ? "active" : ""}`}
                onClick={() => {
                  setFileSource("device");
                  setFileError("");
                }}
              >
                Upload from Device
              </button>

              <button
                type="button"
                className={`file-source-button ${fileSource === "gmail" ? "active" : ""}`}
                onClick={() => {
                  setFileSource("gmail");
                  setFileError("");
                }}
              >
                Connect Gmail
              </button>
            </div>
          )}

          
        {!fileScanResult && fileSource === "gmail" && (
          <div className="gmail-connect-card">
            <div className="gmail-connect-icon">
              <Mail size={30} />
            </div>

            <h3>Scan Gmail Attachments</h3>

            <p className="gmail-connect-description">
              Securely connect your Gmail account to select and
              analyze email attachments for potential security threats.
            </p>

            <button
              type="button"
              className="gmail-connect-button"
              disabled={isFileScanning}
              onClick={() => {
                if (gmailSession) {
                  setGmailPickerOpen(true);
                } else {
                  connectGmail();
                }
              }}
            >
            <Mail size={18} />
            <span>
              {gmailSession
                ? "Browse Gmail Attachments"
                : "Connect to Gmail"}
              </span>
            </button>

            {fileError && (
              <p className="file-error-message">{fileError}</p>
            )}

            <div className="gmail-connect-footer">
              <CheckCircle size={15} />
              <span>Maximum attachment size: 25 MB</span>
            </div>
          </div>
        )}

          {gmailPickerOpen && gmailSession && (
            <GmailAttachmentPicker
              session={gmailSession}
              onClose={() => setGmailPickerOpen(false)}
              onScan={scanGmailAttachment}
            />
          )}

          {!fileScanResult && fileSource === "device" && (
            <div className="file-checker-form">
              <label htmlFor="file-upload">
                FILE
              </label>

              <div className="file-upload-section">
                {/* Drag-and-Drop Area */}
                <div
                  className={`file-drop-zone ${
                    isDragging ? "dragging" : ""
                  } ${
                    selectedFile ? "has-file" : ""
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleFileDrop}
                >
                  <UploadCloud
                    size={42}
                    className="file-upload-icon"
                  />

                  <h3>
                    {selectedFile
                      ? "File Ready to Scan"
                      : "Drag & Drop Your File Here"}
                  </h3>

                  <p>
                    {selectedFile
                      ? selectedFile.name
                      : "Drop a file here or choose one from your device."}
                  </p>

                  <input
                    id="file-upload"
                    type="file"
                    onChange={handleFileSelect}
                    disabled={isFileScanning}
                    style={{ display: "none" }}
                  />

                  <label
                    htmlFor="file-upload"
                    className="choose-file-button"
                    style={
                      isFileScanning
                        ? {
                            opacity: 0.5,
                            pointerEvents: "none",
                          }
                        : undefined
                    }
                  >
                    Choose File
                  </label>

                  {selectedFile && (
                    <p className="file-details">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  )}
                </div>

                {/* Scan Button */}
                <button
                  className="check-file-button"
                  onClick={handleCheckFile}
                  disabled={!selectedFile || isFileScanning}
                >
                  {isFileScanning
                    ? "Scanning..."
                    : "Check File"}
                </button>
              </div>

              {fileError && (
                <p className="file-error-message">
                  {fileError}
                </p>
              )}

              <p className="file-size-note">
                Maximum file size: 25 MB
              </p>
            </div>
          )}

          {/* File Scan Result */}
          {fileScanResult && (
            <div
              className={`link-scan-result ${fileScanResult.classification
                .toLowerCase()
                .replace(" ", "-")}`}
            >
              <div className="result-status">
                <div className="result-icon">
                  {getFileResultIcon()}
                </div>

                <div>
                  <p className="result-label">Scan Result</p>
                  <h2>{fileScanResult.classification}</h2>
                </div>
              </div>

              <div className="result-url">
                <span>Scanned File</span>
                <p>{fileScanResult.filename}</p>
              </div>

              <div className="risk-score-section">
                <div className="risk-score-heading">
                  <span>Risk Score</span>

                  <strong>
                    {fileScanResult.risk_score} / 100
                  </strong>
                </div>

                <div className="risk-score-track">
                  <div
                    className="risk-score-fill"
                    style={{
                      width: `${fileScanResult.risk_score}%`,
                    }}
                  />
                </div>
              </div>

              <div className="result-reasons">
                <h3>File Information</h3>

                <ul>
                  <li>
                    Size:{" "}
                    {formatFileSize(
                      fileScanResult.file_size
                    )}
                  </li>
                  <li>
                    SHA-256: {fileScanResult.sha256}
                  </li>
                </ul>
              </div>

              <div className="result-reasons">
                <h3>Analysis</h3>

                <ul>
                  {fileScanResult.reasons.map(
                    (reason, index) => (
                      <li key={index}>{reason}</li>
                    )
                  )}
                </ul>
              </div>

              <button
                className="scan-another-button"
                onClick={handleScanAnotherFile}
              >
                Scan Another File
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SecurityChecker;