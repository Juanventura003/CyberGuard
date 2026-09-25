import {
  LayoutDashboard,
  Globe2,
  Mail,
  ShieldCheck,
  Bot,
  FileText,
  Settings,
  LogOut,
} from "lucide-react";

import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

import cyberGuardLogo from "../../assets/logo.png";
import "./Sidebar.css";

type SidebarProps = {
  onLogin: () => void;
  onSignUp: () => void;
};

function Sidebar({ onLogin, onSignUp }: SidebarProps) {
  const { session, user, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
  };
  return (
    <aside className="sidebar">
      {/* Logo / Title */}
      <div className="sidebar-header">
        <div className="logo">
          <img src={cyberGuardLogo} alt="CyberGuard logo" />
        </div>

        <h2>CyberGuard</h2>
      </div>

      {/* User / Authentication */}
      <div className="auth-buttons">
        {session ? (
          <div className="sidebar-user">
            <div className="sidebar-user-info">
              <div className="sidebar-profile-icon">
              </div>

              <div className="sidebar-user-text">
                <span className="sidebar-user-label">
                  Signed in as
                </span>

                <span className="sidebar-user-email">
                  {user?.email}
                </span>
              </div>
            </div>

            <button
              className="logout-button"
              onClick={handleLogout}
            >
              <LogOut size={16} />
              Log Out
            </button>
          </div>
        ) : (
          <>
            <button
              className="login-button"
              onClick={onLogin}
            >
              Login
            </button>

            <button
              className="signup-button"
              onClick={onSignUp}
            >
              Sign Up
            </button>
          </>
        )}
    </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </NavLink>

        <NavLink
          to="/website-tracker"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <Globe2 size={18} />
          <span>Website Tracker</span>
        </NavLink>

        <NavLink
          to="/email-scanner"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <Mail size={18} />
          <span>Email Scanner</span>
        </NavLink>

        <NavLink
          to="/security-checker"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <ShieldCheck size={18} />
          <span>Security Checker</span>
        </NavLink>

        <NavLink
          to="/cyber-assistant"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <Bot size={18} />
          <span>Cyber Assistant</span>
        </NavLink>

        <NavLink
          to="/reports"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <FileText size={18} />
          <span>Reports</span>
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
      </nav>
    </aside>
  );
}

export default Sidebar;