
import { useEffect, useState } from "react";
import "./AgentInstallModal.css";
import cyberguardLogo from "../assets/logo.png";
import { checkAgentHealth } from "../lib/localAgent";

type AgentInstallModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function AgentInstallModal({
  isOpen,
  onClose,
}: AgentInstallModalProps) {
  const [checking, setChecking] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);

  
useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const checkAgent = async () => {
        setChecking(true);
        setAgentRunning(false);

        try {
        const health = await checkAgentHealth();

        if (!cancelled) {
            setAgentRunning(health.status === "ready" && health.supported);
        }
        } catch {
        if (!cancelled) {
            setAgentRunning(false);
        }
        } finally {
        if (!cancelled) {
            setChecking(false);
        }
        }
    };

    void checkAgent();

    return () => {
        cancelled = true;
    };
}, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="agent-install-overlay">
      <div
        className="agent-install-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-install-title"
      >
        <div className="agent-install-icon">
            <img
                src={cyberguardLogo}
                alt="CyberGuard Logo"
                className="agent-install-logo"
            />
        </div>

        <h2 id="agent-install-title">CyberGuard Desktop Agent</h2>

        <p className="agent-install-description">
          Unlock local device scanning, real-time system monitoring,
          and advanced protection features with CyberGuard Agent.
        </p>

        <div className="agent-install-status">
          {checking
            ? "Checking for CyberGuard Agent..."
            : agentRunning
              ? "CyberGuard Agent detected"
              : "CyberGuard Agent is not detected"}
        </div>

        <div className="agent-install-features">
          <div>✓ Local Device Scanner</div>
          <div>✓ System Guardian</div>
          <div>✓ Security Monitoring</div>
        </div>

        {agentRunning ? (
          <p className="agent-install-note">
            Your agent is running. Visit Device Scanner or System Guardian
            to complete pairing if needed.
          </p>
        ) : (
          <button
            className="agent-install-download"
            onClick={() => {
              const link = document.createElement("a");
              link.href = "/downloads/CyberGuardSetup.exe";
              link.download = "CyberGuardSetup.exe";
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
          >
            Download CyberGuard Agent
          </button>
        )}

        <button
          className="agent-install-continue"
          onClick={onClose}
        >
          {agentRunning ? "Continue to CyberGuard" : "Continue Without Agent"}
        </button>

        <p className="agent-install-note">
          The desktop agent is optional. Other CyberGuard features
          remain available without it.
        </p>
      </div>
    </div>
  );
}