import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe,
  Mail,
  ShieldCheck,
  Bot,
  AlertTriangle,
} from "lucide-react";

import {
  listWebsiteHistory,
  type WebsiteHistoryEntry,
} from "../../api/emailApi";
import { useAuth } from "../../context/AuthContext";
import {
  SCAN_ACTIVITY_EVENT,
  findingLabel,
  isThreatFinding,
  isTodayIso,
  listEmailScans,
  listSecurityScans,
  type EmailScanEntry,
  type ScanFinding,
  type SecurityScanEntry,
} from "../../lib/scanActivity";

const SAMPLE_ASSISTANT_QUESTION =
  "How can I tell if an email is phishing?";

const POLL_MS = 30_000;

type StatusKind = "safe" | "suspicious" | "danger" | "unverified";

function riskStatus(level: WebsiteHistoryEntry["risk_level"]): StatusKind {
  if (level === "HIGH_RISK") return "danger";
  if (level === "SUSPICIOUS") return "suspicious";
  if (level === "UNABLE_TO_VERIFY") return "unverified";
  return "safe";
}

function riskLabel(level: WebsiteHistoryEntry["risk_level"]) {
  if (level === "HIGH_RISK") return "High Risk";
  if (level === "SUSPICIOUS") return "Suspicious";
  if (level === "UNABLE_TO_VERIFY") return "Unverified";
  return "Safe";
}

function findingStatus(finding: ScanFinding): StatusKind {
  if (finding === "high") return "danger";
  if (finding === "suspicious") return "suspicious";
  if (finding === "unverified") return "unverified";
  return "safe";
}

function statusClass(kind: StatusKind) {
  if (kind === "danger") return "status danger";
  if (kind === "suspicious") return "status suspicious";
  if (kind === "unverified") return "status suspicious";
  return "status safe";
}

/** Keep the latest visit per domain. */
function uniqueByDomain(entries: WebsiteHistoryEntry[]) {
  const sorted = [...entries].sort(
    (a, b) => Date.parse(b.visited_at) - Date.parse(a.visited_at),
  );
  const seen = new Set<string>();
  const unique: WebsiteHistoryEntry[] = [];
  for (const entry of sorted) {
    const key = (entry.domain || entry.url).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function LoggedInDashboard() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [sites, setSites] = useState<WebsiteHistoryEntry[]>([]);
  const [emails, setEmails] = useState<EmailScanEntry[]>([]);
  const [security, setSecurity] = useState<SecurityScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const currentHour = new Date().getHours();
  let greeting = "Good evening";
  if (currentHour < 12) greeting = "Good morning";
  else if (currentHour < 18) greeting = "Good afternoon";

  const refreshLocalActivity = () => {
    if (!userId) {
      setEmails([]);
      setSecurity([]);
      return;
    }
    setEmails(listEmailScans(userId));
    setSecurity(listSecurityScans(userId));
  };

  useEffect(() => {
    refreshLocalActivity();
    const onActivity = () => refreshLocalActivity();
    window.addEventListener(SCAN_ACTIVITY_EVENT, onActivity);
    window.addEventListener("storage", onActivity);
    window.addEventListener("focus", onActivity);
    return () => {
      window.removeEventListener(SCAN_ACTIVITY_EVENT, onActivity);
      window.removeEventListener("storage", onActivity);
      window.removeEventListener("focus", onActivity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when user changes
  }, [userId]);

  useEffect(() => {
    if (!session?.access_token) {
      setSites([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let requestInFlight = false;

    const load = async () => {
      if (cancelled || document.hidden || requestInFlight) return;
      requestInFlight = true;
      try {
        const history = await listWebsiteHistory(
          1000,
          session.access_token,
        );
        if (cancelled) return;
        setSites(history);
        setError("");
      } catch (err) {
        if (cancelled) return;
        console.error("Could not load dashboard history", err);
        setError(
          err instanceof Error
            ? err.message
            : "Could not load your activity.",
        );
      } finally {
        requestInFlight = false;
        if (!cancelled) setLoading(false);
        refreshLocalActivity();
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, userId]);

  const todaySites = useMemo(
    () => uniqueByDomain(sites.filter((s) => isTodayIso(s.visited_at))),
    [sites],
  );
  const todayEmails = useMemo(
    () => emails.filter((e) => isTodayIso(e.occurredAt)),
    [emails],
  );
  const todaySecurity = useMemo(
    () => security.filter((s) => isTodayIso(s.occurredAt)),
    [security],
  );

  const recentSites = useMemo(() => uniqueByDomain(sites).slice(0, 5), [sites]);

  const stats = useMemo(() => {
    const safeSites = todaySites.filter(
      (s) => s.risk_level === "NO_KNOWN_THREAT",
    ).length;
    const siteThreats = todaySites.filter(
      (s) =>
        s.risk_level === "HIGH_RISK" || s.risk_level === "SUSPICIOUS",
    ).length;
    const emailThreats = todayEmails.filter((e) =>
      isThreatFinding(e.finding),
    ).length;
    const securityThreats = todaySecurity.filter((s) =>
      isThreatFinding(s.finding),
    ).length;
    const suspiciousEmails = todayEmails.filter(
      (e) => e.finding === "suspicious" || e.finding === "high",
    ).length;

    return {
      tracked: todaySites.length,
      safeSites,
      emailsScanned: todayEmails.length,
      suspiciousEmails,
      securityChecks: todaySecurity.length,
      threats: siteThreats + emailThreats + securityThreats,
    };
  }, [todaySites, todayEmails, todaySecurity]);

  const websitePreview = todaySites.slice(0, 3);
  const emailPreview = todayEmails.slice(0, 3);

  const recentRows = useMemo(() => {
    type Row = {
      id: string;
      title: string;
      detail: string;
      kind: StatusKind;
      label: string;
      icon: "globe" | "mail" | "threat" | "shield";
      at: number;
    };

    const rows: Row[] = [
      ...recentSites.slice(0, 5).map((entry) => ({
        id: `site-${entry.id}`,
        title:
          entry.risk_level === "HIGH_RISK" ||
          entry.risk_level === "SUSPICIOUS"
            ? "Threat detected"
            : "Website checked",
        detail: entry.domain || entry.url,
        kind: riskStatus(entry.risk_level),
        label: riskLabel(entry.risk_level),
        icon:
          entry.risk_level === "HIGH_RISK" ||
          entry.risk_level === "SUSPICIOUS"
            ? ("threat" as const)
            : ("globe" as const),
        at: Date.parse(entry.visited_at),
      })),
      ...emails.slice(0, 5).map((entry) => ({
        id: `email-${entry.id}`,
        title: isThreatFinding(entry.finding)
          ? "Suspicious email"
          : "Email scanned",
        detail: entry.title,
        kind: findingStatus(entry.finding),
        label: findingLabel(entry.finding),
        icon: isThreatFinding(entry.finding)
          ? ("threat" as const)
          : ("mail" as const),
        at: Date.parse(entry.occurredAt),
      })),
      ...security.slice(0, 5).map((entry) => ({
        id: `sec-${entry.id}`,
        title: isThreatFinding(entry.finding)
          ? "Security risk found"
          : "Security check",
        detail: entry.title,
        kind: findingStatus(entry.finding),
        label: findingLabel(entry.finding),
        icon: isThreatFinding(entry.finding)
          ? ("threat" as const)
          : ("shield" as const),
        at: Date.parse(entry.occurredAt),
      })),
    ];

    return rows
      .sort((a, b) => b.at - a.at)
      .slice(0, 5);
  }, [recentSites, emails, security]);

  return (
    <div className="dashboard">
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

      {error && (
        <p className="dashboard-load-error" role="alert">
          {error} Showing the last loaded data when available.
        </p>
      )}

      <div className="summary-grid">
        <div className="summary-card">
          <Globe size={25} />
          <div>
            <h3>Websites Tracked</h3>
            <h2>{loading && sites.length === 0 ? "—" : stats.tracked}</h2>
            <p>
              {loading && sites.length === 0
                ? "Loading…"
                : `${stats.safeSites} safe website${stats.safeSites === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        <div className="summary-card">
          <Mail size={25} />
          <div>
            <h3>Emails Scanned</h3>
            <h2>{stats.emailsScanned}</h2>
            <p>
              {stats.suspiciousEmails === 0
                ? "No suspicious emails"
                : `${stats.suspiciousEmails} suspicious`}
            </p>
          </div>
        </div>

        <div className="summary-card">
          <ShieldCheck size={25} />
          <div>
            <h3>Security Checks</h3>
            <h2>{stats.securityChecks}</h2>
            <p>
              {stats.securityChecks === 0
                ? "None completed today"
                : "Completed today"}
            </p>
          </div>
        </div>

        <div className="summary-card">
          <AlertTriangle size={25} />
          <div>
            <h3>Threats Found</h3>
            <h2>
              {loading && sites.length === 0 && stats.threats === 0
                ? "—"
                : stats.threats}
            </h2>
            <p>
              {stats.threats === 0
                ? "No threats today"
                : "Review recommended"}
            </p>
          </div>
        </div>
      </div>

      <h2 className="section-title">Today&apos;s Activity</h2>

      <div className="activity-grid">
        <div className="dashboard-panel">
          <div className="panel-title">
            <Globe size={22} />
            <div>
              <h3>Website Activity</h3>
              <p>Recently tracked websites</p>
            </div>
          </div>

          <div className="panel-list">
            {loading && websitePreview.length === 0 ? (
              <div className="panel-row panel-empty">Loading…</div>
            ) : websitePreview.length === 0 ? (
              <div className="panel-row panel-empty">
                No websites tracked today.
              </div>
            ) : (
              websitePreview.map((entry) => (
                <div className="panel-row" key={entry.id}>
                  <span>{entry.domain || entry.url}</span>
                  <span className={statusClass(riskStatus(entry.risk_level))}>
                    {riskLabel(entry.risk_level)}
                  </span>
                </div>
              ))
            )}
          </div>

          <button
            className="dashboard-button"
            type="button"
            onClick={() => navigate("/website-tracker")}
          >
            Open Website Scanner
          </button>
        </div>

        <div className="dashboard-panel">
          <div className="panel-title">
            <Mail size={22} />
            <div>
              <h3>Email Scanner</h3>
              <p>Recent email scans</p>
            </div>
          </div>

          <div className="panel-list">
            {emailPreview.length === 0 ? (
              <div className="panel-row panel-empty">
                No emails scanned today.
              </div>
            ) : (
              emailPreview.map((entry) => (
                <div className="panel-row" key={entry.id}>
                  <span>{entry.title}</span>
                  <span className={statusClass(findingStatus(entry.finding))}>
                    {findingLabel(entry.finding)}
                  </span>
                </div>
              ))
            )}
          </div>

          <button
            className="dashboard-button"
            type="button"
            onClick={() => navigate("/email-scanner")}
          >
            Open Email Scanner
          </button>
        </div>

        <div className="dashboard-panel">
          <div className="panel-title">
            <ShieldCheck size={22} />
            <div>
              <h3>Security Checker</h3>
              <p>
                {todaySecurity.length === 0
                  ? "Run a security check"
                  : `${todaySecurity.length} check${todaySecurity.length === 1 ? "" : "s"} today`}
              </p>
            </div>
          </div>

          <div className="panel-list">
            {todaySecurity.length === 0 ? (
              <div className="panel-row panel-empty">
                No security checks completed today.
              </div>
            ) : (
              todaySecurity.slice(0, 3).map((entry) => (
                <div className="panel-row" key={entry.id}>
                  <span>{entry.title}</span>
                  <span className={statusClass(findingStatus(entry.finding))}>
                    {findingLabel(entry.finding)}
                  </span>
                </div>
              ))
            )}
          </div>

          <button
            className="dashboard-button"
            type="button"
            onClick={() => navigate("/security-checker")}
          >
            Open Security Checker
          </button>
        </div>

        <div className="dashboard-panel">
          <div className="panel-title">
            <Bot size={22} />
            <div>
              <h3>Cyber Assistant</h3>
              <p>Ask a cybersecurity question</p>
            </div>
          </div>

          <div className="assistant-question">
            {SAMPLE_ASSISTANT_QUESTION}
          </div>

          <button
            className="dashboard-button"
            type="button"
            onClick={() =>
              navigate(
                `/cyber-assistant?q=${encodeURIComponent(SAMPLE_ASSISTANT_QUESTION)}`,
              )
            }
          >
            Ask Cyber Assistant
          </button>
        </div>
      </div>

      <h2 className="section-title recent-title">Recent Activity</h2>

      <div className="recent-activity">
        {loading && recentRows.length === 0 ? (
          <div className="recent-row panel-empty">Loading…</div>
        ) : recentRows.length === 0 ? (
          <div className="recent-row panel-empty">
            No recent activity yet. Use Website Tracker, Email Scanner, or
            Security Checker to get started.
          </div>
        ) : (
          recentRows.map((row) => (
            <div className="recent-row" key={row.id}>
              <div className="recent-info">
                {row.icon === "threat" ? (
                  <AlertTriangle size={18} />
                ) : row.icon === "mail" ? (
                  <Mail size={18} />
                ) : row.icon === "shield" ? (
                  <ShieldCheck size={18} />
                ) : (
                  <Globe size={18} />
                )}
                <div>
                  <h4>{row.title}</h4>
                  <p>{row.detail}</p>
                </div>
              </div>
              <span className={statusClass(row.kind)}>{row.label}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LoggedInDashboard;
