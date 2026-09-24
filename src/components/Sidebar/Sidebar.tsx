import {
  LayoutDashboard,
  Globe2,
  Mail,
  ShieldCheck,
  Bot,
  FileText,
  Settings,
} from "lucide-react";

import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

import cyberGuardLogo from "../../assets/logo.png";
import "./Sidebar.css";

function Sidebar() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
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

      {/* Sign Out */}
      <div className="auth-buttons">
        <button className="signout-button" onClick={handleSignOut}>
          Sign Out
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">

        {/* Dashboard */}
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </NavLink>

        {/* Website Tracker */}
        <NavLink
          to="/website-tracker"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <Globe2 size={18} />
          <span>Website Tracker</span>
        </NavLink>

        {/* Email Scanner */}
        <NavLink
          to="/email-scanner"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <Mail size={18} />
          <span>Email Scanner</span>
        </NavLink>

        {/* Security Checker */}
        <NavLink
          to="/security-checker"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <ShieldCheck size={18} />
          <span>Security Checker</span>
        </NavLink>

        {/* Cyber Assistant */}
        <NavLink
          to="/cyber-assistant"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <Bot size={18} />
          <span>Cyber Assistant</span>
        </NavLink>

        {/* Reports */}
        <NavLink
          to="/reports"
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <FileText size={18} />
          <span>Reports</span>
        </NavLink>

        {/* Settings */}
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