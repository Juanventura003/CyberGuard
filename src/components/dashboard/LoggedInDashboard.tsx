import {
  Globe,
  Mail,
  ShieldCheck,
  Bot,
  AlertTriangle,
} from "lucide-react";

function LoggedInDashboard() {
  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const currentHour = new Date().getHours();

  let greeting = "Good evening";

  if (currentHour < 12) {
    greeting = "Good morning";
  } else if (currentHour < 18) {
    greeting = "Good afternoon";
  }

  return (
    <div className="dashboard">
      {/* page heading */}
      <div className="dashboard-header">
        <div>
          <p className="dashboard-date">{currentDate}</p>
          <h1>{greeting}</h1>
          <p className="dashboard-subtitle">
            Here is your CyberGuard activity for today.
          </p>
        </div>

        <div className="monitoring-status">
          <span className="monitoring-dot"></span>
          CyberGuard Active
        </div>
      </div>

      {/* summary */}
      <div className="summary-grid">
        <div className="summary-card">
          <Globe size={25} />

          <div>
            <h3>Websites Tracked</h3>
            <h2>8</h2>
            <p>5 safe websites</p>
          </div>
        </div>

        <div className="summary-card">
          <Mail size={25} />

          <div>
            <h3>Emails Scanned</h3>
            <h2>6</h2>
            <p>1 suspicious email</p>
          </div>
        </div>

        <div className="summary-card">
          <ShieldCheck size={25} />

          <div>
            <h3>Security Checks</h3>
            <h2>4</h2>
            <p>Completed today</p>
          </div>
        </div>

        <div className="summary-card">
          <AlertTriangle size={25} />

          <div>
            <h3>Threats Found</h3>
            <h2>2</h2>
            <p>Review recommended</p>
          </div>
        </div>
      </div>

      <h2 className="section-title">Today's Activity</h2>

      <div className="activity-grid">
        {/* websites */}
        <div className="dashboard-panel">
          <div className="panel-title">
            <Globe size={22} />

            <div>
              <h3>Website Activity</h3>
              <p>Recently tracked websites</p>
            </div>
          </div>

          <div className="panel-list">
            <div className="panel-row">
              <span>github.com</span>
              <span className="status safe">Safe</span>
            </div>

            <div className="panel-row">
              <span>gmail.com</span>
              <span className="status safe">Safe</span>
            </div>

            <div className="panel-row">
              <span>paypal-secure.net</span>
              <span className="status danger">High Risk</span>
            </div>
          </div>

          <button className="dashboard-button">
            View Website History
          </button>
        </div>

        {/* emails */}
        <div className="dashboard-panel">
          <div className="panel-title">
            <Mail size={22} />

            <div>
              <h3>Email Scanner</h3>
              <p>Recent email scans</p>
            </div>
          </div>

          <div className="panel-list">
            <div className="panel-row">
              <span>Amazon Order Confirmation</span>
              <span className="status safe">Safe</span>
            </div>

            <div className="panel-row">
              <span>Account Verification</span>
              <span className="status suspicious">Suspicious</span>
            </div>

            <div className="panel-row">
              <span>School Notification</span>
              <span className="status safe">Safe</span>
            </div>
          </div>

          <button className="dashboard-button">
            Open Email Scanner
          </button>
        </div>

        {/* security checker */}
        <div className="dashboard-panel">
          <div className="panel-title">
            <ShieldCheck size={22} />

            <div>
              <h3>Security Checker</h3>
              <p>Run a security check</p>
            </div>
          </div>

          <div className="security-tools">
            <div>Password Check</div>
            <div>Link Check</div>
            <div>Domain Check</div>
            <div>File Check</div>
          </div>

          <button className="dashboard-button">
            Open Security Checker
          </button>
        </div>

        {/* assistant */}
        <div className="dashboard-panel">
          <div className="panel-title">
            <Bot size={22} />

            <div>
              <h3>Cyber Assistant</h3>
              <p>Ask a cybersecurity question</p>
            </div>
          </div>

          <div className="assistant-question">
            How can I tell if an email is phishing?
          </div>

          <button className="dashboard-button">
            Ask Cyber Assistant
          </button>
        </div>
      </div>

      <h2 className="section-title recent-title">
        Recent Activity
      </h2>

      <div className="recent-activity">
        <div className="recent-row">
          <div className="recent-info">
            <Globe size={18} />

            <div>
              <h4>Website checked</h4>
              <p>github.com</p>
            </div>
          </div>

          <span className="status safe">Safe</span>
        </div>

        <div className="recent-row">
          <div className="recent-info">
            <Mail size={18} />

            <div>
              <h4>Email scanned</h4>
              <p>Account Verification</p>
            </div>
          </div>

          <span className="status suspicious">
            Suspicious
          </span>
        </div>

        <div className="recent-row">
          <div className="recent-info">
            <AlertTriangle size={18} />

            <div>
              <h4>Threat detected</h4>
              <p>paypal-secure.net</p>
            </div>
          </div>

          <span className="status danger">
            High Risk
          </span>
        </div>
      </div>
    </div>
  );
}

export default LoggedInDashboard;