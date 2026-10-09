
import { useEffect, useState } from "react";
import { Mail, Paperclip, X, RefreshCw } from "lucide-react";

const API = "http://127.0.0.1:8000";

type Attachment = {
  index: number;
  filename: string;
  size: number;
};

type GmailMessage = {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet?: string;
  attachments: Attachment[];
};

type Props = {
  session: string;
  onClose: () => void;
  onScan: (
    messageId: string,
    attachmentIndex: number
  ) => Promise<void>;
};

export default function GmailAttachmentPicker({
  session,
  onClose,
  onScan,
}: Props) {
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [selectedEmail, setSelectedEmail] = useState("");
  const [selectedAttachment, setSelectedAttachment] = useState(0);

  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadEmails() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          session,
          limit: "50",
        });

        const response = await fetch(
          `${API}/api/security/gmail/attachments?${params}`
        );

        if (!response.ok) {
          const details = await response.json().catch(() => ({}));
          throw new Error(
            details.detail || "Unable to load Gmail inbox."
          );
        }

        const data: GmailMessage[] = await response.json();

        if (!cancelled) {
          setEmails(data);

          setSelectedEmail((previous) =>
            data.some((email) => email.id === previous)
              ? previous
              : data[0]?.id || ""
          );

          setSelectedAttachment(0);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to connect to Gmail."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadEmails();

    return () => {
      cancelled = true;
    };
  }, [session, refreshCount]);

  const currentEmail = emails.find(
    (email) => email.id === selectedEmail
  );

  const attachments = currentEmail?.attachments ?? [];

  const selectedFile = attachments.find(
    (file) => file.index === selectedAttachment
  );

  function chooseEmail(id: string) {
    setSelectedEmail(id);
    setSelectedAttachment(0);
    setError("");
  }

  async function scanAttachment() {
    if (!currentEmail || !selectedFile || scanning) return;

    setScanning(true);
    setError("");

    try {
      await onScan(currentEmail.id, selectedFile.index);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Attachment scan failed."
      );
    } finally {
      setScanning(false);
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!scanning) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Browse Gmail inbox"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(900px, 96vw)",
          maxHeight: "88vh",
          background: "#181d27",
          color: "#fff",
          border: "1px solid #364153",
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: 20,
            borderBottom: "1px solid #364153",
          }}
        >
          <div>
            <h2
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: 0,
              }}
            >
              <Mail size={24} />
              Gmail Inbox
            </h2>
            <p style={{ color: "#9ca3af", margin: "8px 0 0" }}>
              Browse your latest 50 emails and scan attachments.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              disabled={loading || scanning}
              onClick={() => setRefreshCount((n) => n + 1)}
              aria-label="Refresh inbox"
              style={{
                background: "#283449",
                color: "white",
                border: 0,
                borderRadius: 8,
                padding: 10,
                cursor: "pointer",
              }}
            >
              <RefreshCw size={18} />
            </button>

            <button
              type="button"
              disabled={scanning}
              onClick={onClose}
              aria-label="Close Gmail inbox"
              style={{
                background: "transparent",
                color: "white",
                border: 0,
                cursor: "pointer",
              }}
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            style={{
              margin: "12px 20px",
              color: "#ff8585",
            }}
          >
            {error}
          </p>
        )}

        {loading ? (
          <p style={{ padding: 24 }}>Loading your latest emails...</p>
        ) : emails.length === 0 ? (
          <p style={{ padding: 24 }}>
            No emails were found in your inbox.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              minHeight: 0,
              flex: 1,
              overflow: "hidden",
            }}
          >
            {/* Email list */}
            <div
              style={{
                overflowY: "auto",
                borderRight: "1px solid #364153",
                minHeight: 0,
              }}
            >
              <div
                style={{
                  padding: 14,
                  fontWeight: 700,
                  color: "#aab5c5",
                }}
              >
                Recent Emails ({emails.length})
              </div>

              {emails.map((email) => (
                <button
                  type="button"
                  key={email.id}
                  disabled={scanning}
                  onClick={() => chooseEmail(email.id)}
                  style={{
                    width: "100%",
                    padding: 16,
                    textAlign: "left",
                    border: "none",
                    borderBottom: "1px solid #303947",
                    background:
                      selectedEmail === email.id
                        ? "#304466"
                        : "transparent",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  <strong
                    style={{
                      display: "block",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {email.sender}
                  </strong>

                  <div style={{ marginTop: 6 }}>
                    {email.subject}
                  </div>

                  {email.snippet && (
                    <p
                      style={{
                        fontSize: 12,
                        color: "#b6c1d0",
                        margin: "6px 0",
                      }}
                    >
                      {email.snippet.slice(0, 110)}
                    </p>
                  )}

                  <small
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      color: "#9ca3af",
                      marginTop: 8,
                    }}
                  >
                    <Paperclip size={13} />
                    {email.attachments.length} attachment(s)
                  </small>
                </button>
              ))}
            </div>

            {/* Selected email and attachments */}
            <div
              style={{
                padding: 20,
                overflowY: "auto",
                minHeight: 0,
              }}
            >
              {currentEmail && (
                <>
                  <h3 style={{ marginTop: 0 }}>
                    {currentEmail.subject}
                  </h3>

                  <p
                    style={{
                      color: "#aab5c5",
                      overflowWrap: "anywhere",
                    }}
                  >
                    From: {currentEmail.sender}
                  </p>

                  {currentEmail.date && (
                    <p
                      style={{
                        color: "#aab5c5",
                        fontSize: 12,
                      }}
                    >
                      {currentEmail.date}
                    </p>
                  )}

                  <hr
                    style={{
                      border: 0,
                      borderTop: "1px solid #364153",
                      margin: "20px 0",
                    }}
                  />

                  <h3>Attachments ({attachments.length})</h3>

                  {attachments.length === 0 ? (
                    <p style={{ color: "#aab5c5" }}>
                      This email does not contain any attachments.
                      Select another email to find a file to scan.
                    </p>
                  ) : (
                    <>
                      {attachments.map((file) => (
                        <label
                          key={file.index}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: 12,
                            marginBottom: 8,
                            borderRadius: 8,
                            background: "#252f40",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="radio"
                            name="gmail-attachment"
                            checked={
                              selectedAttachment === file.index
                            }
                            disabled={scanning}
                            onChange={() =>
                              setSelectedAttachment(file.index)
                            }
                          />

                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                overflowWrap: "anywhere",
                              }}
                            >
                              {file.filename}
                            </div>
                            <small style={{ color: "#aab5c5" }}>
                              {formatSize(file.size)}
                            </small>
                          </div>
                        </label>
                      ))}

                      <button
                        type="button"
                        onClick={() => void scanAttachment()}
                        disabled={
                          scanning ||
                          !selectedFile ||
                          selectedFile.size > 25 * 1024 * 1024
                        }
                        style={{
                          width: "100%",
                          padding: 14,
                          marginTop: 16,
                          border: "none",
                          borderRadius: 8,
                          background: "#537be5",
                          color: "white",
                          fontWeight: 700,
                          cursor: scanning
                            ? "wait"
                            : "pointer",
                        }}
                      >
                        {scanning
                          ? "Scanning Attachment..."
                          : "Scan Selected Attachment"}
                      </button>

                      {selectedFile &&
                        selectedFile.size > 25 * 1024 * 1024 && (
                          <p style={{ color: "#ff8585" }}>
                            This attachment exceeds the 25 MB limit.
                          </p>
                        )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}