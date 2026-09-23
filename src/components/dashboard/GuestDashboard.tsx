import {
  Globe,
  Mail,
  Bot,
  Search,
  LogIn,
  UserPlus,
  ShieldCheck,
} from "lucide-react";

import { useNavigate } from "react-router-dom";

function GuestDashboard() {
  const navigate = useNavigate();
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
            Welcome to your CyberGuard security dashboard.
          </p>
        </div>

        <div className="monitoring-status">
          <span className="monitoring-dot"></span>
          CyberGuard Active
        </div>
      </div>

      {/* account section */}
      <div className="guest-login-card">
        <div className="guest-login-content">
          <div className="guest-shield-icon">
            <ShieldCheck size={26} />
          </div>

          <div>
            <h2>Sign in to save your activity</h2>
            <p>
              Log in or create an account to save scans and view your
              security history.
            </p>
          </div>
        </div>

        <div className="guest-login-buttons">
          <button className="guest-login-button">
            <LogIn size={16} />
            Log In
          </button>

          <button className="guest-signup-button">
            <UserPlus size={16} />
            Sign Up
          </button>
        </div>
      </div>

      {/* tools */}
      <h2 className="section-title">Quick Security Tools</h2>

      <div className="guest-tools-grid">
        <div className="guest-tool-card">
          <div className="guest-tool-top">
            <Globe size={24} />
            <h3>Website Tracker</h3>
          </div>

          <p>
            Monitor websites you visit and check them for potential
            security risks.
          </p>

          <button className="guest-tool-button"
          onClick={() => navigate("/website-tracker")}>
            Open Website Tracker
          </button>
        </div>

        <div className="guest-tool-card">
          <div className="guest-tool-top">
            <Mail size={24} />
            <h3>Email Scanner</h3>
          </div>

          <p>
            Scan emails and sender information for signs of phishing.
          </p>

          <button className="guest-tool-button">
            Scan an Email
          </button>
        </div>

        <div className="guest-tool-card">
          <div className="guest-tool-top">
            <Search size={24} />
            <h3>Security Checker</h3>
          </div>

          <p>
            Check links, passwords, files, and domains for security risks.
          </p>

          <button className="guest-tool-button">
            Open Security Checker
          </button>
        </div>

        <div className="guest-tool-card">
          <div className="guest-tool-top">
            <Bot size={24} />
            <h3>Cyber Assistant</h3>
          </div>

          <p>
            Ask cybersecurity questions and get help understanding threats.
          </p>

          <button className="guest-tool-button">
            Open Cyber Assistant
          </button>
        </div>
      </div>
    </div>
  );
}

export default GuestDashboard;