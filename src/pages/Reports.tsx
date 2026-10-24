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
  Link2,
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
import { useAuth } from "../context/AuthContext";
import "./Reports.css";

type Category =
  | "websites"
  | "emails"
  | "links"
  | "files"
  | "passwords"
  | "phones"
  | "addresses"
  | "breaches"
  | "devices"
  | "news";

type Finding = "safe" | "suspicious" | "high" | "unverified" | "info";

type RiskFinding = "safe" | "suspicious" | "high";

type Range = "today" | "yesterday" | "7days" | "30days" | "all" | "custom";

type ReportItem = {
  id: string;
  category: Category;
  title: string;
  detail: string;
  finding: Finding;
  occurredAt: string;
  source: "live" | "demo";
  score?: number;
  notes?: string[];
  passwordStrength?: "strong" | "moderate" | "weak";
  breachFound?: boolean;
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
    id: "links",
    label: "Links scanned",
    icon: Link2,
    description: "URL and link reputation checks",
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
    id: "breaches",
    label: "Data breaches checked",
    icon: ShieldAlert,
    description: "Known breach lookups",
  },
  {
    id: "devices",
    label: "Device scans",
    icon: Laptop,
    description: "Device security assessments",
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

const RISK_CATEGORIES: RiskFinding[] = ["safe", "suspicious", "high"];

const daysAgo = (days: number, hour: number, minute: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

// Temporary sample data.
const DEMO: ReportItem[] = [
  {
    id: "demo-w1",
    category: "websites",
    title: "github.com",
    detail: "Website visit analyzed",
    finding: "safe",
    occurredAt: daysAgo(0, 10, 42),
    source: "demo",
    score: 5,
    notes: ["No known threat indicators detected."],
  },
  {
    id: "demo-w2",
    category: "websites",
    title: "suspicious-download.example",
    detail: "Potentially unsafe website",
    finding: "high",
    occurredAt: daysAgo(0, 10, 15),
    source: "demo",
    score: 92,
    notes: ["Illustrative high-risk detection."],
  },
  {
    id: "demo-w3",
    category: "websites",
    title: "wikipedia.org",
    detail: "Website visit analyzed",
    finding: "safe",
    occurredAt: daysAgo(0, 9, 31),
    source: "demo",
    score: 2,
  },
  {
    id: "demo-e1",
    category: "emails",
    title: "Account verification request",
    detail: "Sender: notifications@example.com",
    finding: "suspicious",
    occurredAt: daysAgo(0, 11, 20),
    source: "demo",
    notes: [
      "Example phishing-language indicators found.",
      "Do not open unexpected verification links.",
    ],
  },
  {
    id: "demo-e2",
    category: "emails",
    title: "Project meeting update",
    detail: "Email content analyzed",
    finding: "safe",
    occurredAt: daysAgo(0, 8, 50),
    source: "demo",
  },
  {
    id: "demo-l1",
    category: "links",
    title: "https://example.com/login",
    detail: "URL reputation check",
    finding: "safe",
    occurredAt: daysAgo(0, 12, 5),
    source: "demo",
  },
  {
    id: "demo-l2",
    category: "links",
    title: "https://suspicious-link.example",
    detail: "URL reputation check",
    finding: "high",
    occurredAt: daysAgo(0, 11, 2),
    source: "demo",
  },
  {
    id: "demo-f1",
    category: "files",
    title: "project-document.pdf",
    detail: "File safety scan",
    finding: "safe",
    occurredAt: daysAgo(0, 10, 20),
    source: "demo",
  },
  {
    id: "demo-f2",
    category: "files",
    title: "installer.exe",
    detail: "Executable inspection",
    finding: "suspicious",
    occurredAt: daysAgo(0, 8, 45),
    source: "demo",
  },
  {
    id: "demo-p1",
    category: "passwords",
    title: "Password strength assessment",
    detail: "Password value not stored in report",
    finding: "suspicious",
    passwordStrength: "weak",
    occurredAt: daysAgo(0, 11, 50),
    source: "demo",
    notes: [
      "Password strength: Weak",
      "Consider using a longer, unique password.",
    ],
  },
  {
    id: "demo-ph1",
    category: "phones",
    title: "Phone reputation lookup",
    detail: "Number ending in ••42",
    finding: "safe",
    occurredAt: daysAgo(0, 9, 20),
    source: "demo",
  },
  {
    id: "demo-a1",
    category: "addresses",
    title: "Email exposure lookup",
    detail: "Address: d•••@example.com",
    finding: "safe",
    occurredAt: daysAgo(0, 9, 10),
    source: "demo",
  },
  {
    id: "demo-b1",
    category: "breaches",
    title: "Breach database lookup",
    detail: "Example account exposure review",
    finding: "high",
    breachFound: true,
    occurredAt: daysAgo(0, 9, 0),
    source: "demo",
    notes: [
      "Email address appeared in a known data breach.",
      "Consider changing passwords for affected accounts.",
      "Enable two-factor authentication where available.",
    ],
  },
  {
    id: "demo-d1",
    category: "devices",
    title: "Windows security assessment",
    detail: "Device scan completed",
    finding: "safe",
    occurredAt: daysAgo(0, 10, 0),
    source: "demo",
  },
  {
    id: "demo-n1",
    category: "news",
    title: "Understanding phishing campaigns",
    detail: "Cybersecurity article viewed",
    finding: "info",
    occurredAt: daysAgo(0, 9, 25),
    source: "demo",
  },
  {
    id: "demo-n2",
    category: "news",
    title: "How to protect online accounts",
    detail: "Cybersecurity article viewed",
    finding: "info",
    occurredAt: daysAgo(1, 14, 5),
    source: "demo",
  },
];

const riskOf = (risk: WebsiteHistoryEntry["risk_level"]): Finding => {
  if (risk === "HIGH_RISK") return "high";
  if (risk === "SUSPICIOUS") return "suspicious";
  if (risk === "NO_KNOWN_THREAT") return "safe";
  return "unverified";
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

  if (range === "today") {
    return value >= today;
  }

  if (range === "yesterday") {
    return value >= today - 86400000 && value < today;
  }

  if (range === "7days") {
    return value >= today - 6 * 86400000;
  }

  if (range === "30days") {
    return value >= today - 29 * 86400000;
  }

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

  const [live, setLive] = useState<ReportItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(Boolean(session?.access_token));

  // Keep temporary records enabled until other report APIs exist.
  const showDemo = true;

  const [range, setRange] = useState<Range>("today");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [search, setSearch] = useState("");

  const [selectedCategory, setSelectedCategory] = useState<Category | "all">(
    "all",
  );

  const [expanded, setExpanded] = useState<string | null>(null);

  // Load actual Website Tracker history.
  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;

    async function load() {
      try {
        const history = await listWebsiteHistory(1000, session?.access_token);

        if (cancelled) return;

        setLive(
          history.map((entry): ReportItem => ({
            id: `website-${entry.id}`,
            category: "websites",
            title: entry.domain || entry.url,
            detail: entry.url,
            finding: riskOf(entry.risk_level),
            occurredAt: entry.visited_at,
            source: "live",
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
          })),
        );

        setLoadError("");
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load website history.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    const timer = window.setInterval(() => void load(), 30000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session?.access_token]);

  const items = useMemo(
    () =>
      [...live, ...(showDemo ? DEMO : [])]
        .filter((item) => inRange(item.occurredAt, range, start, end))
        .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
    [live, range, start, end, showDemo],
  );

  const flagged = items.filter(
    (item) => item.finding === "high" || item.finding === "suspicious",
  );

  // Unverified and informational records do not enter
  const riskTotal = items.filter((item) =>
    RISK_CATEGORIES.includes(item.finding as RiskFinding),
  ).length;

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
    data_source: item.source,
    notes: (item.notes ?? []).join("; "),
  }));

  const exportJson = () =>
    download(
      "cyberguard-security-report.json",
      JSON.stringify(
        {
          period: periodLabel,
          contains_demo_data: shown.some((item) => item.source === "demo"),
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
    if (item.category === "breaches") {
      if (typeof item.breachFound === "boolean") {
        return item.breachFound ? "Yes" : "No";
      }

      return "Not checked";
    }

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
    if (item.category === "breaches") {
      if (typeof item.breachFound === "boolean") {
        return item.breachFound ? "high" : "safe";
      }

      return "unverified";
    }
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
      {/* PAGE HEADER */}
      <header className="report-topbar no-print">
        <div>
          <h1>Security Activity Report</h1>
          <p>A complete record of your CyberGuard security activity.</p>
        </div>

        <div className="report-top-actions">
          <button type="button" onClick={() => window.print()}>
            <Printer size={16} />
            Print / Save PDF
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
      </header>

      {/* DATE FILTER */}
      <div className="report-controls no-print">
        <label>
          <CalendarDays size={16} />
          Report period
          <select
            value={range}
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
            <label>
              From
              <input
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>

            <label>
              To
              <input
                type="date"
                min={start || undefined}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {loadError && (
        <div className="report-notice report-error">
          Website history could not be loaded: {loadError}
        </div>
      )}

      <article className="report-document">
        {/* REPORT HEADER */}
        <section className="report-document-header">
          <div>
            <h2>{periodLabel} — Security Summary</h2>
            <p>Generated {new Date().toLocaleString()}</p>
          </div>

          <div className="report-id">
            <span>REPORT TYPE</span>
            <strong>Activity overview</strong>

            <span>STATUS</span>
            <strong>{loading ? "Loading" : "Generated"}</strong>
          </div>
        </section>

        {/* SECTION 1: EXECUTIVE SUMMARY */}
        <section className="report-section">
          <div className="report-section-title">
            <span>01</span>
            <h3>Executive summary</h3>
          </div>

          <p className="report-intro">
            CyberGuard recorded <strong>{items.length} activities</strong> in
            the selected period across{" "}
            <strong>
              {
                CATEGORIES.filter((category) =>
                  items.some((item) => item.category === category.id),
                ).length
              }{" "}
              security categories
            </strong>
            .{" "}
            {flagged.length
              ? `${flagged.length} activities were flagged for review.`
              : "No high-risk or suspicious findings are present in the displayed records."}
          </p>

          {/* THREE SUMMARY CARDS */}
          <div className="report-metrics">
            <div>
              <Activity size={19} />
              <span>Total activities</span>
              <strong>{items.length}</strong>
            </div>

            <div>
              <CheckCircle2 size={19} color="#059669" />
              <span>Safe</span>
              <strong>
                {items.filter((item) => item.finding === "safe").length}
              </strong>
            </div>

            <div>
              <AlertTriangle size={19} color="#e6a000" />
              <span>Suspicious</span>
              <strong>
                {items.filter((item) => item.finding === "suspicious").length}
              </strong>
            </div>

            <div>
              <ShieldAlert size={19} color="#ef4444" />
              <span>High risk</span>
              <strong>
                {items.filter((item) => item.finding === "high").length}
              </strong>
            </div>
          </div>

          {/* THREE-CATEGORY RISK DISTRIBUTION */}
          <div className="report-risk-overview">
            <div className="report-risk-head">
              <strong>Risk distribution</strong>
              <span>{riskTotal} classified security results</span>
            </div>

            <div className="report-risk-track">
              {RISK_CATEGORIES.map((finding) => {
                const count = items.filter(
                  (item) => item.finding === finding,
                ).length;

                if (count === 0) return null;

                return (
                  <span
                    key={finding}
                    className={`report-risk-fill ${finding}`}
                    style={{
                      width: `${(count / Math.max(riskTotal, 1)) * 100}%`,
                    }}
                  />
                );
              })}
            </div>

            <div className="report-risk-legend">
              {RISK_CATEGORIES.map((finding) => (
                <span key={finding}>
                  <i className={`report-dot ${finding}`} />
                  {FINDINGS[finding]}:{" "}
                  {items.filter((item) => item.finding === finding).length}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 2: SECURITY CATEGORIES */}
        <section className="report-section">
          <div className="report-section-title">
            <span>02</span>
            <h3>Activity by security category</h3>
          </div>

          <p className="report-section-desc">
            Every security feature is represented below. Categories without
            recorded activity show zero.
          </p>

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

                    document.getElementById("report-activity")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  <span className="report-category-icon">
                    <Icon size={19} />
                  </span>

                  <span className="report-category-name">{label}</span>

                  <strong>{group.length}</strong>

                  <small>
                    {warnings
                      ? `${warnings} flagged`
                      : group.length
                        ? "No flagged findings"
                        : "No activity"}
                  </small>
                </button>
              );
            })}
          </div>
        </section>

        {/* SECTION 3: DETAILED ACTIVITY LOG */}
        <section className="report-section" id="report-activity">
          <div className="report-section-title">
            <span>03</span>
            <h3>Detailed activity log</h3>
          </div>

          <div className="report-log-controls no-print">
            <label className="report-search">
              <Search size={17} />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search activity, domain, filename, or result..."
              />

              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X size={16} />
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
                        <div>
                          <strong>Source:</strong>{" "}
                          {item.source === "demo"
                            ? "Sample data (not a real scan)"
                            : "Saved website history"}
                        </div>

                        {/* PASSWORD CHECKER DETAILS */}
                        {item.category === "passwords" && (
                          <div className="report-password-detail">
                            <strong>Password checked:</strong>

                            <div className="report-password-field">
                              <span>••••••••••••</span>
                              <span className="report-password-private">
                                Hidden for security
                              </span>
                            </div>

                            <p>
                              <strong>Password strength:</strong>{" "}
                              <span
                                className={`report-finding ${getResultClass(item)}`}
                              >
                                {getResultLabel(item)}
                              </span>
                            </p>

                            <small>
                              The original password is not stored in the report
                              and cannot be revealed.
                            </small>
                          </div>
                        )}

                        {/* RISK SCORE FOR OTHER SECURITY CHECKS */}
                        {item.category !== "passwords" &&
                          typeof item.score === "number" && (
                            <div>
                              <strong>Risk score:</strong> {item.score}/100
                            </div>
                          )}

                        {/* ADDITIONAL SCAN DETAILS */}
                        {item.notes?.length ? (
                          <ul>
                            {item.notes.map((note, index) => (
                              <li key={index}>{note}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No additional details recorded.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="report-empty">
                <FileText size={25} />

                <strong>No matching activities</strong>

                <p>
                  {loading
                    ? "Loading saved history…"
                    : "No activities match your selected filters."}
                </p>
              </div>
            )}
          </div>

          <p className="report-footnote">
            Showing {shown.length} of {items.length} activities for{" "}
            {periodLabel.toLowerCase()}.{" "}
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
