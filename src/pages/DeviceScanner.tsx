import {
  Monitor,
  ShieldCheck,
  Flame,
  AlertTriangle,
} from "lucide-react";

import "./DeviceScanner.css";

function DeviceScanner() {
  return (
    <div className="device-scanner-page">
      {/* Header */}
      <div className="device-scanner-header">
        <h1>Device Scanner</h1>
        <p>
          Scan your Windows device for potential security threats.
        </p>
      </div>

      {/* Device Card */}
      <div className="device-card">
        <div className="device-card-top">
          <div className="device-icon">
            <Monitor size={30} />
          </div>

          <div>
            <h2>Windows Device</h2>
            <p>Check your device for security threats.</p>
          </div>

          <span className="device-ready">Ready to Scan</span>
        </div>

        <button className="scan-device-button">
          <ShieldCheck size={18} />
          Scan Device
        </button>
      </div>

      {/* Security Status */}
      <h2 className="device-section-title">Security Status</h2>

      <div className="device-status-grid">
        <div className="device-status-card">
          <ShieldCheck size={25} />

          <div>
            <h3>Antivirus</h3>
            <p>Not Checked</p>
          </div>
        </div>

        <div className="device-status-card">
          <Flame size={25} />

          <div>
            <h3>Firewall</h3>
            <p>Not Checked</p>
          </div>
        </div>

        <div className="device-status-card">
          <AlertTriangle size={25} />

          <div>
            <h3>Threats</h3>
            <p>Not Checked</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeviceScanner;