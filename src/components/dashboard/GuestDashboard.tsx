import {
  Globe,
  Mail,
  Search,
  Bot,
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
    </div>
  );
}

export default GuestDashboard;