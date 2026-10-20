import { lazy, Suspense, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import PageErrorBoundary from "./components/PageErrorBoundary";
import Sidebar from "./components/Sidebar/Sidebar";
import AuthModal from "./components/auth/AuthModal";

const Organization = lazy(() => import("./pages/Organization"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const WebsiteTracker = lazy(() => import("./pages/WebsiteTracker"));
const EmailScanner = lazy(() => import("./pages/EmailScanner"));
const SecurityChecker = lazy(() => import("./pages/SecurityChecker"));
const DeviceScanner = lazy(() => import("./pages/DeviceScanner"));
const CyberAssistant = lazy(() => import("./pages/CyberAssistant"));
const News = lazy(() => import("./pages/News"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));

import { OrganizationPresenceProvider } from "./context/OrganizationPresenceContext";
import { useAuth } from "./context/AuthContext";

import "./App.css";

function App() {
  const { session, loading } = useAuth();
  const location = useLocation();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");

  const openLogin = () => {
    setAuthMode("login");
    setAuthModalOpen(true);
  };

  const openSignUp = () => {
    setAuthMode("signup");
    setAuthModalOpen(true);
  };

  return (
    <OrganizationPresenceProvider
      key={session?.user.id ?? "guest"}
      userId={session?.user.id ?? null}
    >
      <div className="app">
        <Sidebar onLogin={openLogin} onSignUp={openSignUp} />

        <main className="main-content">
          <PageErrorBoundary key={location.pathname}>
            <Suspense
              fallback={
                <div className="route-loading" role="status">
                  Loading page…
                </div>
              }
            >
              <Routes>
                {/* Default route */}
                <Route
                  path="/"
                  element={<Navigate to="/dashboard" replace />}
                />

                {/* CyberGuard Pages */}
                <Route path="/organization" element={<Organization />} />
                <Route path="/dashboard" element={<Dashboard />} />

                <Route path="/website-tracker" element={<WebsiteTracker />} />

                <Route path="/email-scanner" element={<EmailScanner />} />

                <Route path="/security-checker" element={<SecurityChecker />} />

                {/* Login Required */}
                <Route
                  path="/device-scanner"
                  element={
                    loading ? (
                      <div style={{ padding: "32px" }}>
                        <p>Loading...</p>
                      </div>
                    ) : session ? (
                      <DeviceScanner />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />

                <Route path="/cyber-assistant" element={<CyberAssistant />} />

                <Route path="/news" element={<News />} />

                <Route path="/reports" element={<Reports />} />

                <Route path="/settings" element={<Settings />} />

                {/* Unknown route */}
                <Route
                  path="*"
                  element={<Navigate to="/dashboard" replace />}
                />
              </Routes>
            </Suspense>
          </PageErrorBoundary>
        </main>

        {/* Authentication popup */}
        <AuthModal
          key={authMode}
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          startingMode={authMode}
        />
      </div>
    </OrganizationPresenceProvider>
  );
}

export default App;
