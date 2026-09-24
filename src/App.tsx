import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import Sidebar from "./components/Sidebar/Sidebar";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import WebsiteTracker from "./pages/WebsiteTracker";
import EmailScanner from "./pages/EmailScanner";
import SecurityChecker from "./pages/SecurityChecker";
import CyberAssistant from "./pages/CyberAssistant";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";

import "./App.css";

function AppLayout() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />

      {/* Protected app routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          {/* Default route */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* CyberGuard Pages */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/website-tracker" element={<WebsiteTracker />} />
          <Route path="/email-scanner" element={<EmailScanner />} />
          <Route path="/security-checker" element={<SecurityChecker />} />
          <Route path="/cyber-assistant" element={<CyberAssistant />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />

          {/* Unknown route */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;