import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  AtSign,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSearch,
  FileText,
  Globe2,
  KeyRound,
  Laptop,
  Mail,
  Newspaper,
  Phone,
  Printer,
  Search,
  ShieldAlert,
  X,
  LockKeyhole,
} from "lucide-react";

import { listWebsiteHistory, type WebsiteHistoryEntry } from "../api/emailApi";
import { fetchNewsActivity } from "../api/newsApi";
import { useAuth } from "../context/AuthContext";
import {
  SCAN_ACTIVITY_EVENT,
  listEmailScans,
  listSecurityScans,
  syncEmailScans,
  type EmailScanEntry,
  type SecurityScanEntry,
} from "../lib/scanActivity";
import "./Reports.css";

type Category =
  | "websites"
  | "emails"
  | "files"
  | "passwords"
  | "phones"
  | "addresses"
  | "devices"
  | "news";

type Finding = "safe" | "suspicious" | "high" | "unverified" | "info";

type Range = "today" | "yesterday" | "7days" | "30days" | "all" | "custom";

type ReportSource =
  | "website_history"
  | "email_scanner"
  | "security_checker"
  | "device_scanner"
  | "news";

type ReportItem = {
  id: string;
  category: Category;
  title: string;
  detail: string;
  finding: Finding;
  occurredAt: string;
  source: ReportSource;
  score?: number;
  notes?: string[];
  passwordStrength?: "strong" | "moderate" | "weak";
};

const CATEGORIES: {
  id: Category;
  label: string;
  icon: typeof Globe2;
  description: string;
}[] = [
  {
    id: "websites",
    label: "Websites tracked",
    icon: Globe2,
    description: "Sites visited and evaluated by Website Tracker",
  },
  {
    id: "emails",
    label: "Emails scanned",
    icon: Mail,
    description: "Phishing and suspicious-message detection",
  },
  {
    id: "files",
    label: "Files scanned",
    icon: FileSearch,
    description: "Malware and file-integrity checks",
  },
  {
    id: "passwords",
    label: "Passwords checked",
    icon: KeyRound,
    description: "Password strength and exposure checks",
  },
  {
    id: "phones",
    label: "Phone numbers checked",
    icon: Phone,
    description: "Phone-number reputation lookups",
  },
  {
    id: "addresses",
    label: "Email addresses checked",
    icon: AtSign,
    description: "Email-address reputation and exposure",
  },
  {
    id: "devices",
    label: "Device scans",
    icon: Laptop,
    description: "Device Scanner security assessments",
  },
  {
    id: "news",
    label: "News articles viewed",
    icon: Newspaper,
    description: "Cybersecurity news reading activity",
  },
];

const FINDINGS: Record<Finding, string> = {
  safe: "No known threat",
  suspicious: "Suspicious",
  high: "High risk",
  unverified: "Unverified",
  info: "Informational",
};

const SOURCE_LABELS: Record<ReportSource, string> = {
  website_history: "Website Tracker history",
  email_scanner: "Email Scanner activity",
  security_checker: "Security Checker activity",
  device_scanner: "Device Scanner activity",
  news: "News reading activity",
};

const SECURITY_CATEGORY: Record<SecurityScanEntry["checkType"], Category> = {
  file: "files",
  password: "passwords",
  phone: "phones",
  email_address: "addresses",
  device: "devices",
};

const securitySourceOf = (
  checkType: SecurityScanEntry["checkType"],
): ReportSource => {
  if (checkType === "device") return "device_scanner";
  return "security_checker";
};

const riskOf = (risk: WebsiteHistoryEntry["risk_level"]): Finding => {
  if (risk === "HIGH_RISK") return "high";
  if (risk === "SUSPICIOUS") return "suspicious";
  if (risk === "NO_KNOWN_THREAT") return "safe";
  return "unverified";
};

const passwordStrengthOf = (
  entry: SecurityScanEntry,
): "strong" | "moderate" | "weak" => {
  const detail = entry.detail.toLowerCase();
  if (detail.includes("strong") || detail.includes("good")) return "strong";
  if (detail.includes("fair")) return "moderate";
  if (detail.includes("weak")) return "weak";
  if (entry.finding === "safe") return "strong";
  if (entry.finding === "suspicious") return "moderate";
  return "weak";
};

const websiteToReportItem = (entry: WebsiteHistoryEntry): ReportItem => ({
  id: `website-${entry.id}`,
  category: "websites",
  title: entry.domain || entry.url,
  detail: entry.url,
  finding: riskOf(entry.risk_level),
  occurredAt: entry.visited_at,
  source: "website_history",
  score:
    typeof entry.risk_score === "number"
      ? Math.round(entry.risk_score)
      : undefined,
  notes: [
    ...(entry.threat_types ?? []).map(
      (t) => `Threat type: ${t.replaceAll("_", " ")}`,
    ),
    ...(entry.explanation ?? []),
  ],
});

const emailToReportItem = (entry: EmailScanEntry): ReportItem => ({
  id: `email-${entry.id}`,
  category: "emails",
  title: entry.title,
  detail: entry.detail.startsWith("Sender:")
    ? entry.detail
    : `Sender: ${entry.detail}`,
  finding: entry.finding,
  occurredAt: entry.occurredAt,
  source: "email_scanner",
});

const securityToReportItem = (entry: SecurityScanEntry): ReportItem => {
  const category = SECURITY_CATEGORY[entry.checkType];
  const isPassword = entry.checkType === "password";

  return {
    id: `security-${entry.id}`,
    category,
    title: entry.title,
    detail: isPassword ? "Password value not stored in report" : entry.detail,
    finding: entry.finding,
    occurredAt: entry.occurredAt,
    source: securitySourceOf(entry.checkType),
    passwordStrength: isPassword ? passwordStrengthOf(entry) : undefined,
    notes: isPassword
      ? [
          `Password strength: ${entry.detail}`,
          "The original password is not stored.",
        ]
      : undefined,
  };
};

const dateText = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const dayStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const inRange = (iso: string, range: Range, start: string, end: string) => {
  const value = Date.parse(iso);

  if (!Number.isFinite(value)) return false;
  if (range === "all") return true;

  const today = dayStart(new Date());

  if (range === "today") return value >= today;
  if (range === "yesterday") {
    return value >= today - 86400000 && value < today;
  }
  if (range === "7days") return value >= today - 6 * 86400000;
  if (range === "30days") return value >= today - 29 * 86400000;
  if (!start || !end) return false;

  return (
    value >= new Date(`${start}T00:00:00`).getTime() &&
    value <= new Date(`${end}T23:59:59.999`).getTime()
  );
};

const csvEscape = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Reports() {
  const { session } = useAuth();
  return <ReportsContent key={session?.user.id ?? "guest"} />;
}

function ReportsContent() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const [websites, setWebsites] = useState<ReportItem[]>([]);
  const [emails, setEmails] = useState<ReportItem[]>([]);
  const [security, setSecurity] = useState<ReportItem[]>([]);
  const [news, setNews] = useState<ReportItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(Boolean(session?.access_token));

  const [range, setRange] = useState<Range>("today");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [search, setSearch] = useState("");

  const [selectedCategory, setSelectedCategory] = useState<Category | "all">(
    "all",
  );

  const [expanded, setExpanded] = useState<string | null>(null);

  const refreshLocalActivity = () => {
    if (!userId) {
      setEmails([]);
      setSecurity([]);
      return;
    }

    setEmails(listEmailScans(userId).map(emailToReportItem));
    setSecurity(listSecurityScans(userId).map(securityToReportItem));
  };

  // Email Scanner + Security Checker history (localStorage + Supabase emails).
  useEffect(() => {
    refreshLocalActivity();
    if (userId) void syncEmailScans(userId).then(refreshLocalActivity);
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

  // Website Tracker history + news reading activity.
  useEffect(() => {
    if (!session?.access_token || !userId) {
      setWebsites([]);
      setNews([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let requestInFlight = false;

    async function load() {
      if (cancelled || document.hidden || requestInFlight) return;
      requestInFlight = true;

      try {
        const [history, newsActivity] = await Promise.all([
          listWebsiteHistory(1000, session?.access_token),
          fetchNewsActivity(userId!).catch(() => []),
        ]);

        if (cancelled) return;

        setWebsites(history.map(websiteToReportItem));
        setNews(
          newsActivity
            .filter((item) => item.read && item.article)
            .map((item) => ({
              id: `news-${item.article.id}`,
              category: "news" as const,
              title: item.article.title,
              detail: item.article.source
                ? `Article from ${item.article.source}`
                : "Cybersecurity article viewed",
              finding: "info" as const,
              occurredAt:
                item.updated_at ||
                item.article.published_at ||
                new Date().toISOString(),
              source: "news" as const,
              notes: item.article.summary ? [item.article.summary] : undefined,
            })),
        );
        setLoadError("");
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load report activity.",
          );
        }
      } finally {
        requestInFlight = false;
        if (!cancelled) {
          setLoading(false);
          refreshLocalActivity();
        }
      }
    }

    void load();

    const timer = window.setInterval(() => void load(), 30000);
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when session changes
  }, [session?.access_token, userId]);

  const items = useMemo(
    () =>
      [...websites, ...emails, ...security, ...news]
        .filter((item) => inRange(item.occurredAt, range, start, end))
        .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
    [websites, emails, security, news, range, start, end],
  );

  const flagged = items.filter(
    (item) => item.finding === "high" || item.finding === "suspicious",
  );

  const counts = useMemo(
    () => ({
      safe: items.filter((item) => item.finding === "safe").length,
      suspicious: items.filter((item) => item.finding === "suspicious").length,
      high: items.filter((item) => item.finding === "high").length,
    }),
    [items],
  );

  const shown = useMemo(
    () =>
      items.filter((item) => {
        if (selectedCategory !== "all" && item.category !== selectedCategory) {
          return false;
        }

        const q = search.trim().toLowerCase();

        return (
          !q ||
          [
            item.title,
            item.detail,
            FINDINGS[item.finding],
            ...(item.notes ?? []),
          ].some((value) => value.toLowerCase().includes(q))
        );
      }),
    [items, selectedCategory, search],
  );

  const periodLabel =
    range === "today"
      ? "Today"
      : range === "yesterday"
        ? "Yesterday"
        : range === "7days"
          ? "Last 7 days"
          : range === "30days"
            ? "Last 30 days"
            : range === "all"
              ? "All time"
              : `${start || "Start"} to ${end || "End"}`;

  const exportRows = shown.map((item) => ({
    category: item.category,
    title: item.title,
    detail: item.detail,
    finding: FINDINGS[item.finding],
    score: item.score ?? "",
    date: item.occurredAt,
    data_source: SOURCE_LABELS[item.source],
    notes: (item.notes ?? []).join("; "),
  }));

  const exportJson = () =>
    download(
      "cyberguard-security-report.json",
      JSON.stringify(
        {
          period: periodLabel,
          generated_at: new Date().toISOString(),
          activities: exportRows,
        },
        null,
        2,
      ),
      "application/json",
    );

  const exportCsv = () => {
    const headers = [
      "category",
      "title",
      "detail",
      "finding",
      "score",
      "date",
      "data_source",
      "notes",
    ] as const;

    download(
      "cyberguard-security-report.csv",
      [
        headers.join(","),
        ...exportRows.map((row) =>
          headers.map((key) => csvEscape(row[key])).join(","),
        ),
      ].join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };

  const getResultLabel = (item: ReportItem) => {
    if (item.category === "passwords" && item.passwordStrength) {
      return {
        strong: "Strong",
        moderate: "Moderate",
        weak: "Weak",
      }[item.passwordStrength];
    }

    return FINDINGS[item.finding];
  };

  const getResultClass = (item: ReportItem) => {
    if (item.category === "passwords" && item.passwordStrength) {
      return {
        strong: "safe",
        moderate: "suspicious",
        weak: "high",
      }[item.passwordStrength];
    }

    return item.finding;
  };

  if (!session) {
    return (
      <main className="reports-page">
        <div className="report-guest-container">
          <div className="report-guest-icon">
            <LockKeyhole size={32} />
          </div>

          <h2>Sign in to view your security reports</h2>

          <p>
            CyberGuard saves your security activity and scan history to your
            account. Log in or create an account to view your reports.
          </p>

          <div className="report-guest-actions">
            <button
              className="report-guest-button"
              onClick={() => window.location.assign("/login")}
            >
              Log In
            </button>

            <button
              className="report-guest-button secondary"
              onClick={() => window.location.assign("/signup")}
            >
              Create Account
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="reports-page">
      <header className="report-topbar no-print">
        <div>
          <h1>Security reports</h1>
          <p>
            {loading
              ? "Loading activity…"
              : flagged.length
                ? `${items.length} activities · ${flagged.length} flagged`
                : `${items.length} activities in this period`}
          </p>
        </div>

        <div className="report-toolbar">
          <label className="report-period">
            <CalendarDays size={16} />
            <select
              value={range}
              aria-label="Report period"
              onChange={(event) => setRange(event.target.value as Range)}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7days">Last 7 days</option>
              <option value="30days">Last 30 days</option>
              <option value="all">All time</option>
              <option value="custom">Custom range</option>
            </select>
          </label>

          {range === "custom" && (
            <div className="report-custom-dates">
              <input
                type="date"
                aria-label="From date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
              <span>to</span>
              <input
                type="date"
                aria-label="To date"
                min={start || undefined}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
          )}

          <div className="report-top-actions">
            <button type="button" onClick={() => window.print()}>
              <Printer size={16} />
              Print
            </button>
            <button type="button" onClick={exportCsv}>
              <Download size={16} />
              CSV
            </button>
            <button type="button" onClick={exportJson}>
              <Download size={16} />
              JSON
            </button>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="report-notice report-error">
          Some report activity could not be loaded: {loadError}
        </div>
      )}

      <article className="report-document">
        <section className="report-document-header">
          <div>
            <h2>{periodLabel}</h2>
            <p>Generated {new Date().toLocaleString()}</p>
          </div>
        </section>

        <section className="report-section">
          <div className="report-section-title">
            <h3>Summary</h3>
          </div>

          <div className="report-metrics">
            <div>
              <Activity size={18} />
              <span>Total</span>
              <strong>{items.length}</strong>
            </div>
            <div>
              <CheckCircle2 size={18} />
              <span>Safe</span>
              <strong>{counts.safe}</strong>
            </div>
            <div>
              <AlertTriangle size={18} />
              <span>Suspicious</span>
              <strong>{counts.suspicious}</strong>
            </div>
            <div>
              <ShieldAlert size={18} />
              <span>High risk</span>
              <strong>{counts.high}</strong>
            </div>
          </div>
        </section>

        <section className="report-section">
          <div className="report-section-title">
            <h3>Categories</h3>
          </div>

          <div className="report-category-grid">
            {CATEGORIES.map(({ id, label, icon: Icon }) => {
              const group = items.filter((item) => item.category === id);
              const warnings = group.filter(
                (item) =>
                  item.finding === "high" || item.finding === "suspicious",
              ).length;

              return (
                <button
                  type="button"
                  key={id}
                  className={`report-category-card ${
                    selectedCategory === id ? "selected" : ""
                  }`}
                  onClick={() => {
                    setSelectedCategory(selectedCategory === id ? "all" : id);
                    document
                      .getElementById("report-activity")
                      ?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                  }}
                >
                  <span className="report-category-top">
                    <span className="report-category-icon">
                      <Icon size={16} />
                    </span>
                    <strong>{group.length}</strong>
                  </span>
                  <span className="report-category-name">{label}</span>
                  {warnings > 0 && (
                    <small className="report-category-flag">
                      {warnings} flagged
                    </small>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="report-section" id="report-activity">
          <div className="report-section-title">
            <h3>Activity</h3>
          </div>

          <div className="report-log-controls no-print">
            <label className="report-search">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search activity…"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>

            <select
              aria-label="Activity category"
              value={selectedCategory}
              onChange={(event) =>
                setSelectedCategory(event.target.value as Category | "all")
              }
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`report-log-head ${
              selectedCategory === "news" ? "news-view" : ""
            }`}
          >
            <span>Activity</span>
            <span>Category</span>

            {selectedCategory !== "news" && <span>Finding</span>}

            <span>Time</span>
          </div>

          <div className="report-log-table">
            {shown.length ? (
              shown.map((item) => {
                const category = CATEGORIES.find(
                  (category) => category.id === item.category,
                )!;

                const open = expanded === item.id;

                return (
                  <div key={item.id} className="report-log-entry">
                    <button
                      type="button"
                      className={`report-log-row ${
                        selectedCategory === "news" ? "news-view" : ""
                      }`}
                      onClick={() => setExpanded(open ? null : item.id)}
                      aria-expanded={open}
                    >
                      <span className="report-log-main">
                        {open ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}

                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                      </span>

                      <span>{category.label}</span>
                      {selectedCategory !== "news" && (
                        <span>
                          {item.category !== "news" && (
                            <span
                              className={`report-finding ${getResultClass(item)}`}
                            >
                              {getResultLabel(item)}
                            </span>
                          )}
                        </span>
                      )}

                      <span className="report-log-time">
                        {dateText(item.occurredAt)}
                      </span>
                    </button>

                    {open && (
                      <div className="report-log-detail">
                        <p>
                          <strong>Source</strong> {SOURCE_LABELS[item.source]}
                        </p>

                        {item.category === "passwords" && (
                          <p>
                            Password strength:{" "}
                            <span
                              className={`report-finding ${getResultClass(item)}`}
                            >
                              {getResultLabel(item)}
                            </span>
                            . The password itself is not stored.
                          </p>
                        )}

                        {item.category !== "passwords" &&
                          typeof item.score === "number" && (
                            <p>
                              <strong>Risk score</strong> {item.score}/100
                            </p>
                          )}

                        {item.notes?.length ? (
                          <ul>
                            {item.notes.map((note, index) => (
                              <li key={index}>{note}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="report-empty">
                <FileText size={25} />

                <strong>
                  {loading
                    ? "Loading your report…"
                    : items.length === 0
                      ? "No security activity yet"
                      : "No matching activities"}
                </strong>

                <p>
                  {loading
                    ? "Gathering recent activity…"
                    : items.length === 0
                      ? "Scan emails, run Device Scanner, check security items, or use Website Tracker — activity appears here automatically."
                      : "Try a different period or clear your search."}
                </p>
              </div>
            )}
          </div>

          <p className="report-footnote">
            {shown.length} of {items.length} · {periodLabel.toLowerCase()}
          </p>
        </section>

        {/* REPORT FOOTER */}
        <footer className="report-footer">
          <span className="report-footer-brand">
            <img
              src="/logo.png"
              alt="CyberGuard logo"
              className="report-footer-logo"
            />
            CYBERGUARD
          </span>

          <span className="report-footer-date">
            {new Date().toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </footer>
      </article>
    </main>
  );
}
