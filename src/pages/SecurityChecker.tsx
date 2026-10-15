import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import {
  FileText,
  KeyRound,
  Phone,
  Mail,
  Database,
  CheckCircle,
  AlertTriangle,
  XCircle,
  UploadCloud,
  Eye, 
  EyeOff, 
  ShieldCheck, 
  CircleCheck, 
  Circle
} from "lucide-react";

import "./SecurityChecker.css";
import GmailAttachmentPicker from "../components/GmailAttachmentPopup";
import {
  API_BASE,
  startGmailConnect,
  saveGmailSession,
  loadGmailSession,
  clearGmailSession,
} from "../api/emailApi";

import { useAuth } from "../context/AuthContext";

import zxcvbn from "zxcvbn";

import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

type CheckerType =
  | "file"
  | "password"
  | "phone"
  | "email"
  | "breach";

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
  const { session, loading } = useAuth();
  const isLoggedIn = !loading && !!session;
  const [activeChecker, setActiveChecker] = useState<CheckerType>("file");

  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [isFileScanning, setIsFileScanning] = useState(false);
  const [fileScanResult, setFileScanResult] =
    useState<FileScanResult | null>(null);

  const [fileSource, setFileSource] = useState<"device" | "gmail">("device");
  const [gmailSession, setGmailSession] = useState(
    () => loadGmailSession() || ""
  );
  const [gmailPickerOpen, setGmailPickerOpen] = useState(false);


  useEffect(() => {
    const syncGmailSession = () => {
      const savedSession = loadGmailSession() || "";
      setGmailSession(savedSession);

      if (!savedSession) {
        setGmailPickerOpen(false);
      }
    };

    window.addEventListener("focus", syncGmailSession);
    window.addEventListener("storage", syncGmailSession);

    return () => {
      window.removeEventListener("focus", syncGmailSession);
      window.removeEventListener("storage", syncGmailSession);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const session = params.get("gmail_session");
    const error = params.get("gmail_error");
    const checker = params.get("checker");

    if (checker === "file" || session) {
      setActiveChecker("file");
    }

    if (session) {
      saveGmailSession(session);
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
    if (!isLoggedIn) return;

    const returnTo =
      `${window.location.origin}${window.location.pathname}?checker=file`;

    startGmailConnect(returnTo);
  };

  const scanGmailAttachment = async (
    messageId: string,
    attachmentIndex: number
  ) => {

    if (!isLoggedIn) {
      throw new Error("Please log in to CyberGuard first.");
    }
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
        `${API_BASE}/api/security/gmail/scan-attachment?${params}`,
        { method: "POST" }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
          clearGmailSession();
          setGmailSession("");
          setGmailPickerOpen(false);

          throw new Error(
            "Your Gmail session expired. Please reconnect your Gmail account."
          );
        }

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

  type PhoneReputationResult = {
    fraud_score: number | null;
    spammer: boolean | null;
    recent_abuse: boolean | null;
    risky: boolean | null;
    voip: boolean | null;
    carrier: string | null;
    line_type: string | null;
    valid: boolean | null;
  };

  const [phoneInput, setPhoneInput] = useState("");
  const [phoneReputation, setPhoneReputation] =
    useState<PhoneReputationResult | null>(null);

  const [phoneReputationLoading, setPhoneReputationLoading] = useState(false);
  const [phoneReputationError, setPhoneReputationError] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>("US");
  const [phoneError, setPhoneError] = useState("");
  const [phoneResult, setPhoneResult] = useState<{
    valid: boolean;
    possible: boolean;
    international: string;
    national: string;
    country: string;
    callingCode: string;
    type: string;
  } | null>(null);

  const handleCheckPhone = () => {
    setPhoneError("");
    setPhoneResult(null);
    setPhoneReputation(null);
    setPhoneReputationError("");

    if (!phoneInput.trim()) {
      setPhoneError("Please enter a phone number.");
      return;
    }

    try {
      const parsed = parsePhoneNumberFromString(phoneInput, phoneCountry);

      if (!parsed) {
        setPhoneError("Unable to recognize this phone number.");
        return;
      }

      const valid = parsed.isValid();
      const possible = parsed.isPossible();

      setPhoneResult({
        valid,
        possible,
        international: parsed.formatInternational(),
        national: parsed.formatNational(),
        country: parsed.country || "Unknown",
        callingCode: `+${parsed.countryCallingCode}`,
        type: parsed.getType() || "Unknown",
      });
    } catch {
      setPhoneError("Unable to analyze this phone number.");
    }
  };

  const handleCheckPhoneReputation = async () => {
    if (!phoneResult?.valid) return;

    setPhoneReputationLoading(true);
    setPhoneReputationError("");
    setPhoneReputation(null);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/security/phone-reputation",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone_number: phoneResult.international,
            country: phoneResult.country !== "Unknown"
              ? phoneResult.country
              : phoneCountry,
          }),
        }
      );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Phone reputation lookup failed.");
    }

    const data: PhoneReputationResult = await response.json();
    setPhoneReputation(data);
  } catch (error) {
    setPhoneReputationError(
      error instanceof Error ? error.message : "Unable to check phone reputation."
    );
  } finally {
    setPhoneReputationLoading(false);
  }
};

  const handleResetPhone = () => {
    setPhoneInput("");
    setPhoneError("");
    setPhoneResult(null);
    setPhoneReputation(null);
    setPhoneReputationError("");
  };
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const passwordResult = password ? zxcvbn(password) : null;
  const passwordScore = passwordResult?.score ?? 0;

  const passwordChecks = [
    {
      label: "At least 12 characters",
      passed: password.length >= 12,
    },
    {
      label: "At least 16 characters (recommended)",
      passed: password.length >= 16,
    },
    {
      label: "Uses a mix of character types",
      passed:
        [
          /[a-z]/.test(password),
          /[A-Z]/.test(password),
          /[0-9]/.test(password),
          /[^A-Za-z0-9]/.test(password),
        ].filter(Boolean).length >= 3,
    },
  ];

  const estimatedCrackTime =
    passwordResult?.crack_times_display.offline_slow_hashing_1e4_per_second ??
    "Not available";

  const passwordSuggestions = passwordResult
    ? [
        ...(password.length < 12
          ? ["Use a longer password or passphrase with at least 12 characters."]
          : []),
        ...(passwordResult.feedback.warning
          ? [passwordResult.feedback.warning]
          : []),
        ...passwordResult.feedback.suggestions,
      ]
    : [];
  const strengthLabels = [
    "Very Weak",
    "Weak",
    "Fair",
    "Good",
    "Strong",
  ];

  const strengthColors = [
    "#dc3545",
    "#ef4444",
    "#d99a00",
    "#4169e1",
    "#198754",
  ];

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
          className={`checker-option ${
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
          className={`checker-option ${
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
                {"Choose from Device"}
              </button>

              <button
                type="button"
                className={`file-source-button ${fileSource === "gmail" ? "active" : ""}`}
                onClick={() => {
                  setFileSource("gmail");
                  setFileError("");
                }}
              >
                {isLoggedIn && gmailSession
                  ? "Gmail Connected"
                  : "Connect Gmail"}
              </button>
            </div>
          )}

          
        
      {!fileScanResult && fileSource === "gmail" && (
        !isLoggedIn ? (
          <div
            className="gmail-connect-card gmail-locked-card"
            aria-disabled="true"
            title="Log in to CyberGuard to use Gmail scanning"
          >
            <div className="gmail-connect-icon">
              <Mail size={30} />
            </div>

            <h3>Connect Gmail account</h3>

            <p className="gmail-connect-description">
              Log in to your CyberGuard account to connect Gmail
              and scan email attachments directly from your inbox.
            </p>
          </div>
        ) : (
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
          )
        )}

          {isLoggedIn && gmailPickerOpen && gmailSession && (
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
              className={`file-scan-result ${fileScanResult.classification
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

              <div className="result-file">
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

    {/* PASSWORD CHECKER */}
    {activeChecker === "password" && (
      <div className="checker-panel">
        <div className="checker-panel-title">
          <div className="checker-panel-icon">
            <KeyRound size={22} />
          </div>
          <div>
            <h2>Password Strength Checker</h2>
            <p>Analyze your password strength and receive security recommendations.</p>
          </div>
        </div>

        <div className="password-checker-form">
          <label htmlFor="password-input">PASSWORD</label>

          <div className="password-input-row">
            <input
              id="password-input"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a password to analyze"
              autoComplete="off"
              spellCheck={false}
            />

            <button
              type="button"
              className="password-visibility-button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>

          {passwordResult && (
            <div className="password-analysis">
              <div className="password-strength-heading">
                <span>Password Strength</span>
                <strong style={{ color: strengthColors[passwordScore] }}>
                  {strengthLabels[passwordScore]}
                </strong>
              </div>

              <div className="password-strength-meter">
                {[0, 1, 2, 3, 4].map((index) => (
                  <div
                    key={index}
                    className="password-strength-segment"
                    style={{
                      backgroundColor:
                        index <= passwordScore
                          ? strengthColors[passwordScore]
                          : "#e1e5eb",
                    }}
                  />
                ))}
              </div>
                
              {/* Password Checklist */}
              <div className="password-checklist">
                <h3>Password Recommendations</h3>

                {passwordChecks.map((check) => (
                  <div className="password-check-item" key={check.label}>
                    {check.passed ? (
                      <CircleCheck size={19} className="check-passed" />
                    ) : (
                      <Circle size={19} className="check-pending" />
                    )}
                    <span>{check.label}</span>
                  </div>
                ))}
              </div>

              {/* Estimated Cracking Time */}
              <div className="password-crack-time">
                <div className="password-crack-time-heading">
                  <ShieldCheck size={20} />
                  <h3>Estimated Cracking Time</h3>
                </div>

                <p className="crack-time-value">
                  {estimatedCrackTime}
                </p>

                <p className="crack-time-description">
                  Estimated time for an offline attack against a slow
                  password hash. Actual cracking times may vary.
                </p>
              </div>

              {/* Security Analysis */}
              <div className="password-feedback">
                <h3>Security Analysis</h3>

                {passwordSuggestions.length > 0 ? (
                  <ul>
                    {passwordSuggestions.map((suggestion, index) => (
                      <li key={index}>{suggestion}</li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    <ShieldCheck size={18} />
                    No obvious weaknesses detected. Use unique passwords
                    for every account.
                  </p>
                )}
              </div>

              {/* Reset Password Checker */}
              <button
                type="button"
                className="scan-another-button"
                onClick={() => {
                  setPassword("");
                  setShowPassword(false);
                }}
              >
                Check Another Password
              </button>
            </div>
          )}

          {/* Privacy Notice */}
          <p className="password-privacy-note">
            CyberGuard does not send or save the entered password.
          </p>
        </div>
      </div>
    )}

    {/* PHONE NUMBER CHECKER */}
    {activeChecker === "phone" && (
      <div className="checker-panel">
        <div className="checker-panel-title">
          <div className="checker-panel-icon">
            <Phone size={22} />
          </div>
          <div>
            <h2>Phone Number Checker</h2>
            <p>Validate a phone number and view its information.</p>
          </div>
        </div>

        <div className="phone-checker-form">
          <label htmlFor="phone-input">PHONE NUMBER</label>

          <div className="phone-input-row">
            <select
              className="phone-country-select"
              value={phoneCountry}
              onChange={(e) => {
                setPhoneCountry(e.target.value as CountryCode);
                setPhoneResult(null);
                setPhoneError("");
                setPhoneReputation(null);
                setPhoneReputationError("");
              }}
            >
              <option value="US">United States (+1)</option>
              <option value="CA">Canada (+1)</option>
              <option value="GB">United Kingdom (+44)</option>
              <option value="AU">Australia (+61)</option>
              <option value="IN">India (+91)</option>
              <option value="FR">France (+33)</option>
              <option value="DE">Germany (+49)</option>
              <option value="JP">Japan (+81)</option>
              <option value="MX">Mexico (+52)</option>
            </select>

            <input
              id="phone-input"
              type="tel"
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                setPhoneResult(null);
                setPhoneError("");
                setPhoneReputation(null);
                setPhoneReputationError("");
              }}
              placeholder="Enter a phone number"
            />
          </div>

          <button
            type="button"
            className="check-phone-button"
            onClick={handleCheckPhone}
          >
            Check Phone Number
          </button>

          {phoneError && (
            <p className="phone-error-message">{phoneError}</p>
          )}

          {phoneResult && (
            <div className="phone-analysis">
              <div className="phone-result-heading">
                {phoneResult.valid ? (
                  <CheckCircle size={26} color="#198754" />
                ) : (
                  <AlertTriangle size={26} color="#d99a00" />
                )}

                <div>
                  <h3>
                    {phoneResult.valid
                      ? "Valid Phone Number"
                      : "Invalid Phone Number"}
                  </h3>
                  <p>
                    {phoneResult.valid
                      ? "This number matches the numbering rules for its region."
                      : "This number does not meet the numbering rules for its region."}
                  </p>
                </div>
              </div>

              <div className="phone-details">
                <div className="phone-detail-item">
                  <span>Country / Region</span>
                  <strong>{phoneResult.country}</strong>
                </div>

                <div className="phone-detail-item">
                  <span>Country Calling Code</span>
                  <strong>{phoneResult.callingCode}</strong>
                </div>

                <div className="phone-detail-item">
                  <span>International Format</span>
                  <strong>{phoneResult.international}</strong>
                </div>

                <div className="phone-detail-item">
                  <span>National Format</span>
                  <strong>{phoneResult.national}</strong>
                </div>

                <div className="phone-detail-item">
                  <span>Number Type</span>
                  <strong>{phoneResult.type.replace(/_/g, " ")}</strong>
                </div>

                <div className="phone-detail-item">
                  <span>Possible Number Length</span>
                  <strong>{phoneResult.possible ? "Yes" : "No"}</strong>
                </div>
              </div>
              
              {phoneResult.valid && (
              <div className="phone-reputation-section">
                <h3>Spam & Scam Detection</h3>
                <p>
                  Check whether this number has suspicious activity reported by
                  our phone reputation provider.
                </p>

                <button
                  type="button"
                  className="check-phone-button"
                  onClick={handleCheckPhoneReputation}
                  disabled={phoneReputationLoading}
                >
                  {phoneReputationLoading
                    ? "Checking Reputation..."
                    : "Check Spam & Scam Risk"}
                </button>

                {phoneReputationError && (
                  <p className="phone-error-message">{phoneReputationError}</p>
                )}

                {phoneReputation && (
                  <div className="phone-reputation-results">
                    <div className="phone-reputation-score">
                      <span>Fraud Score</span>
                      <strong>
                        {phoneReputation.fraud_score === null
                          ? "Not Available"
                          : `${phoneReputation.fraud_score}/100`}
                      </strong>
                    </div>

                    <div className="phone-details">
                      {[
                        ["Spam Indicator", phoneReputation.spammer],
                        ["Recent Abuse", phoneReputation.recent_abuse],
                        ["Risk Flag", phoneReputation.risky],
                        ["VoIP Number", phoneReputation.voip],
                      ].map(([label, value]) => (
                        <div className="phone-detail-item" key={String(label)}>
                          <span>{String(label)}</span>
                          <strong>
                            {value === null
                              ? "Unknown"
                              : value === true
                              ? "Yes"
                              : "No"}
                          </strong>
                        </div>
                      ))}

                      <div className="phone-detail-item">
                        <span>Carrier</span>
                        <strong>{phoneReputation.carrier || "Unknown"}</strong>
                      </div>

                      <div className="phone-detail-item">
                        <span>Line Type</span>
                        <strong>{phoneReputation.line_type || "Unknown"}</strong>
                      </div>
                    </div>

                    <p className="phone-reputation-disclaimer">
                      Reputation results are indicators, not proof that a caller
                      is safe or malicious. Caller ID can be spoofed.
                    </p>
                  </div>
                )}
              </div>
            )}
              <button
                type="button"
                className="scan-another-button"
                onClick={handleResetPhone}
              >
                Check Another Number
              </button>
            </div>
          )}
        </div>
      </div>
    )}
  </div>
  );
}

export default SecurityChecker;