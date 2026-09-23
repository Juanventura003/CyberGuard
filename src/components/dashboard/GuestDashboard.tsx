import {
  Globe,
  Mail,
  Bot,
  Search,
  LogIn,
  UserPlus,
  ShieldCheck,
} from "lucide-react";

function GuestDashboard() {
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

      {/* header */}
      <div className="dashboard-header">
        <div>
          <p className="dashboard-date">{currentDate}</p>

          <h1>
            {greeting}
          </h1>

          <p className="dashboard-subtitle">
            Welcome to your CyberGuard security dashboard.
          </p>
        </div>

        <div className="monitoring-status">
          <span className="monitoring-dot"></span>
          CyberGuard Active
        </div>
      </div>

      {/* login section */}
      <div className="guest-login-card">
        <div className="guest-login-content">
          <div className="guest-shield-icon">
            <ShieldCheck size={27} />
          </div>

          <div>
            <h2>Sign in to track your security activity</h2>

            <p>
              Log in or create an account to save your scans, website
              activity, security checks, and daily reports.
            </p>
          </div>
        </div>

        <div className="guest-login-buttons">
          <button className="guest-login-button">
            <LogIn size={17} />
            Log In
          </button>

          <button className="guest-signup-button">
            <UserPlus size={17} />
            Sign Up
          </button>
        </div>
      </div>

        {/* quick tools heading */}
      <div className="guest-section-header">
        <h2>Quick Security Tools</h2>

        <p>
          You can still use CyberGuard without an account. Your activity
          will not be saved.
        </p>
      </div>

      {/* security tools layout */}
      <div className="guest-tools-grid">

        {/* website tracker */}
        <div className="guest-tool-card">
          <div className="guest-tool-top">
            <div className="guest-tool-icon blue">
              <Globe size={22} />
            </div>
            <div>
              <h3>Website Tracker</h3>
              <span>Website Security</span>
            </div>
          </div>

          <p className="guest-tool-description">
            Monitor websites you visit and check domains for potential
            security risks.
          </p>

          <button className="guest-tool-button">
            Open Website Tracker →
          </button>
        </div>

        {/* email scanner */}
        <div className="guest-tool-card">
          <div className="guest-tool-top">
            <div className="guest-tool-icon purple">
              <Mail size={22} />
            </div>

            <div>
              <h3>Email Scanner</h3>
              <span>Phishing Detection</span>
            </div>
          </div>

          <p className="guest-tool-description">
            Scan email content and sender information for signs of phishing
            or suspicious activity.
          </p>

          <button className="guest-tool-button">
            Scan an Email →
          </button>
        </div>
        
        {/* security checker */}
        <div className="guest-tool-card">
          <div className="guest-tool-top">
            <div className="guest-tool-icon cyan">
              <Search size={22} />
            </div>

            <div>
              <h3>Security Checker</h3>
              <span>Security Tools</span>
            </div>
          </div>


          <p className="guest-tool-description">
            Check links, passwords, files, and domains using CyberGuard's
            security tools.
          </p>

          <button className="guest-tool-button">
            Open Security Tools →
          </button>
        </div>

        {/* cyber ai assistant */}
        <div className="guest-tool-card">
          <div className="guest-tool-top">
            <div className="guest-tool-icon green">
              <Bot size={22} />
            </div>

            <div>
              <h3>Cyber Assistant</h3>
              <span>Security Help</span>
            </div>
          </div>


          <p className="guest-tool-description">
            Ask cybersecurity questions and get help understanding online
            threats and security concepts.
          </p>

          <button className="guest-tool-button">
            Ask Cyber Assistant →
          </button>
        </div>
      </div>

      {/* bottom message benefits to make account */}
      <div className="guest-benefits-card">
        <div className="guest-benefits-info">
          <div className="guest-benefits-icon">
            <ShieldCheck size={22} />
          </div>

          <div>
            <h3>Want to keep track of your security?</h3>

            <p>
              Create an account to save activity and view personalized
              security reports.
            </p>
          </div>
        </div>

        <div className="guest-benefits-list">
          <span>✓ Save website activity</span>
          <span>✓ Save email scans</span>
          <span>✓ View security history</span>
          <span>✓ Generate daily reports</span>
        </div>
      </div>
    </div>
  );
}

export default GuestDashboard;