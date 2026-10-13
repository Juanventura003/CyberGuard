import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Globe2,
  Mail,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { listWebsiteHistory, type WebsiteHistoryEntry } from "../api/emailApi";
import { useAuth } from "../context/AuthContext";
import "./Reports.css";

type DateFilter = "all" | "today" | "7days" | "30days" | "custom";
type RiskFilter = "all" | "NO_KNOWN_THREAT" | "SUSPICIOUS" | "HIGH_RISK" | "UNABLE_TO_VERIFY";

type ReportEntry = {
  id: string;
  url: string;
  domain: string;
  riskScore: number;
  riskLevel: WebsiteHistoryEntry["risk_level"];
  source: WebsiteHistoryEntry["source"];
  threatTypes: string[];
  explanation: string[];
  visitedAt: string;
};

const RISK_LABELS: Record<WebsiteHistoryEntry["risk_level"], string> = {
  NO_KNOWN_THREAT: "No Known Threat",
  SUSPICIOUS: "Suspicious",
  HIGH_RISK: "High Risk",
  UNABLE_TO_VERIFY: "Unable to Verify",
};

const RISK_CLASS: Record<WebsiteHistoryEntry["risk_level"], string> = {
  NO_KNOWN_THREAT: "safe",
  SUSPICIOUS: "suspicious",
  HIGH_RISK: "danger",
  UNABLE_TO_VERIFY: "unable",
};

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const toDayKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDayKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const startOfDayIso = (key: string) => {
  const date = parseDayKey(key);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
};

const endOfDayMs = (key: string) => {
  const date = parseDayKey(key);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
};

const formatDayLabel = (key: string) =>
  parseDayKey(key).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const getSinceDate = (
  filter: DateFilter,
  customStart: string | null,
) => {
  if (filter === "custom") {
    return customStart ? startOfDayIso(customStart) : undefined;
  }

  if (filter === "all") return undefined;

  const since = new Date();
  if (filter === "today") {
    since.setHours(0, 0, 0, 0);
  } else {
    since.setDate(since.getDate() - (filter === "7days" ? 7 : 30));
  }
  return since.toISOString();
};

const getDateRangeLabel = (
  filter: DateFilter,
  customStart: string | null,
  customEnd: string | null,
) => {
  if (filter === "all") return "All time";
  if (filter === "today") return "Today";
  if (filter === "7days") return "Last 7 days";
  if (filter === "30days") return "Last 30 days";
  if (customStart && customEnd) {
    return `${formatDayLabel(customStart)} – ${formatDayLabel(customEnd)}`;
  }
  return "Custom range";
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const formatThreat = (threat: string) =>
  threat
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const downloadBlob = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const toCsv = (entries: ReportEntry[]) => {
  const header = [
    "domain",
    "url",
    "risk_score",
    "risk_level",
    "source",
    "threat_types",
    "visited_at",
  ];

  const rows = entries.map((entry) =>
    [
      entry.domain,
      entry.url,
      String(entry.riskScore),
      RISK_LABELS[entry.riskLevel],
      entry.source,
      entry.threatTypes.join("; "),
      entry.visitedAt,
    ]
      .map((value) => `"${value.replaceAll('"', '""')}"`)
      .join(","),
  );

  return [header.join(","), ...rows].join("\n");
};

function Reports() {
  const { session } = useAuth();
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("30days");
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [draftEnd, setDraftEnd] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const customRangeReady = Boolean(customStart && customEnd);
  const shouldLoadCustom = dateFilter !== "custom" || customRangeReady;

  useEffect(() => {
    if (!calendarOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!datePickerRef.current?.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [calendarOpen]);

  useEffect(() => {
    let ignore = false;

    const loadReports = async () => {
      if (!shouldLoadCustom) {
        setEntries([]);
        setSelectedId(null);
        setLoading(false);
        return;
      }

      try {
        const history = await listWebsiteHistory(
          100,
          session?.access_token,
          getSinceDate(dateFilter, customStart),
        );
        if (ignore) return;

        const untilMs =
          dateFilter === "custom" && customEnd ? endOfDayMs(customEnd) : null;

        const mapped = history
          .filter((entry) =>
            untilMs === null ? true : Date.parse(entry.visited_at) <= untilMs,
          )
          .map((entry) => ({
            id: entry.id,
            url: entry.url,
            domain: entry.domain,
            riskScore: Math.round(entry.risk_score),
            riskLevel: entry.risk_level,
            source: entry.source,
            threatTypes: entry.threat_types ?? [],
            explanation: entry.explanation ?? [],
            visitedAt: entry.visited_at,
          }));

        setEntries(mapped);
        setSelectedId((current) => {
          if (current && mapped.some((entry) => entry.id === current)) {
            return current;
          }
          return mapped[0]?.id ?? null;
        });
      } catch (loadError) {
        console.error("Could not load reports", loadError);
        if (!ignore) {
          setEntries([]);
          setSelectedId(null);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    setLoading(true);
    void loadReports();
    const timer = window.setInterval(() => {
      void loadReports();
    }, 15000);

    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [customEnd, customStart, dateFilter, session?.access_token, shouldLoadCustom]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();

    return entries.filter((entry) => {
      if (riskFilter !== "all" && entry.riskLevel !== riskFilter) return false;
      if (!query) return true;

      return [entry.domain, entry.url, RISK_LABELS[entry.riskLevel], ...entry.threatTypes]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [entries, riskFilter, search]);

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ key: string | null; label: number | null }> = [];

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({ key: null, label: null });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({
        key: toDayKey(new Date(year, month, day)),
        label: day,
      });
    }

    return cells;
  }, [calendarMonth]);

  const openCustomCalendar = (nextStart = customStart, nextEnd = customEnd) => {
    setDraftStart(nextStart);
    setDraftEnd(nextEnd);
    const focusKey = nextEnd ?? nextStart ?? toDayKey(new Date());
    const focusDate = parseDayKey(focusKey);
    setCalendarMonth(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1));
    setCalendarOpen(true);
  };

  const handleDateFilterChange = (value: DateFilter) => {
    setDateFilter(value);
    if (value === "custom") {
      openCustomCalendar();
      return;
    }
    setCalendarOpen(false);
  };

  const handleCalendarDayClick = (dayKey: string) => {
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(dayKey);
      setDraftEnd(null);
      return;
    }

    if (dayKey < draftStart) {
      setDraftEnd(draftStart);
      setDraftStart(dayKey);
      return;
    }

    setDraftEnd(dayKey);
  };

  const applyCustomRange = () => {
    if (!draftStart || !draftEnd) return;
    setCustomStart(draftStart);
    setCustomEnd(draftEnd);
    setDateFilter("custom");
    setCalendarOpen(false);
  };

  const clearCustomRange = () => {
    setDraftStart(null);
    setDraftEnd(null);
    setCustomStart(null);
    setCustomEnd(null);
  };

  const dayTone = (dayKey: string) => {
    const start = draftStart;
    const end = draftEnd;
    if (!start) return "";
    if (start && !end) return dayKey === start ? "selected" : "";
    if (dayKey === start || dayKey === end) return "selected";
    if (dayKey > start && dayKey < end!) return "in-range";
    return "";
  };

  const todayKey = toDayKey(new Date());
  const dateRangeLabel = getDateRangeLabel(dateFilter, customStart, customEnd);
  const exportSlug =
    dateFilter === "custom" && customStart && customEnd
      ? `${customStart}_to_${customEnd}`
      : dateFilter;

  const selected =
    filtered.find((entry) => entry.id === selectedId) ??
    filtered[0] ??
    null;

  const safeCount = entries.filter((e) => e.riskLevel === "NO_KNOWN_THREAT").length;
  const suspiciousCount = entries.filter((e) => e.riskLevel === "SUSPICIOUS").length;
  const highRiskCount = entries.filter((e) => e.riskLevel === "HIGH_RISK").length;
  const unableCount = entries.filter((e) => e.riskLevel === "UNABLE_TO_VERIFY").length;
  const avgScore =
    entries.length === 0
      ? 0
      : Math.round(entries.reduce((sum, entry) => sum + entry.riskScore, 0) / entries.length);

  const distributionTotal = Math.max(entries.length, 1);
  const distribution = [
    { key: "safe", label: "Safe", count: safeCount, className: "safe" },
    { key: "suspicious", label: "Suspicious", count: suspiciousCount, className: "suspicious" },
    { key: "danger", label: "High Risk", count: highRiskCount, className: "danger" },
    { key: "unable", label: "Unverified", count: unableCount, className: "unable" },
  ];

  const exportJson = () => {
    downloadBlob(
      `cyberguard-reports-${exportSlug}.json`,
      JSON.stringify(
        filtered.map((entry) => ({
          domain: entry.domain,
          url: entry.url,
          risk_score: entry.riskScore,
          risk_level: RISK_LABELS[entry.riskLevel],
          source: entry.source,
          threat_types: entry.threatTypes,
          explanation: entry.explanation,
          visited_at: entry.visitedAt,
        })),
        null,
        2,
      ),
      "application/json",
    );
  };

  const exportCsv = () => {
    downloadBlob(
      `cyberguard-reports-${exportSlug}.csv`,
      toCsv(filtered),
      "text/csv;charset=utf-8",
    );
  };

  const riskFilters: { id: RiskFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: entries.length },
    { id: "HIGH_RISK", label: "High Risk", count: highRiskCount },
    { id: "SUSPICIOUS", label: "Suspicious", count: suspiciousCount },
    { id: "NO_KNOWN_THREAT", label: "Safe", count: safeCount },
    { id: "UNABLE_TO_VERIFY", label: "Unverified", count: unableCount },
  ];

  return (
    <div className="reports-page">
      <div className="reports-header">
        <div>
          <p className="reports-date">{currentDate}</p>
          <h1>Reports</h1>
          <p className="reports-subtitle">
            Scan summaries from website checks, with risk breakdown and exportable history.
          </p>
        </div>

        <div className="monitoring-status">
          <span className="monitoring-dot" />
          Reports Ready
        </div>
      </div>

      {!session && (
        <div className="reports-guest">
          <FileText size={18} />
          <div>
            <strong>Guest Mode</strong>
            <p>Sign in to save and review your personal scan reports across sessions.</p>
          </div>
        </div>
      )}

      <div className="reports-overview">
        <div className="reports-stat">
          <span>Total Scans</span>
          <strong>{entries.length}</strong>
        </div>
        <div className="reports-stat">
          <span>High Risk</span>
          <strong className="danger-text">{highRiskCount}</strong>
        </div>
        <div className="reports-stat">
          <span>Suspicious</span>
          <strong className="suspicious-text">{suspiciousCount}</strong>
        </div>
        <div className="reports-stat">
          <span>Avg Risk Score</span>
          <strong>{avgScore}</strong>
        </div>
      </div>

      <div className="reports-distribution">
        <div className="reports-distribution-head">
          <h2>Risk distribution</h2>
          <p>{dateRangeLabel}</p>
        </div>

        <div
          className="reports-distribution-bar"
          role="img"
          aria-label={`Risk distribution: ${safeCount} safe, ${suspiciousCount} suspicious, ${highRiskCount} high risk, ${unableCount} unverified`}
        >
          {distribution.map((segment) =>
            segment.count > 0 ? (
              <span
                key={segment.key}
                className={`reports-bar-segment ${segment.className}`}
                style={{ width: `${(segment.count / distributionTotal) * 100}%` }}
                title={`${segment.label}: ${segment.count}`}
              />
            ) : null,
          )}
          {entries.length === 0 && <span className="reports-bar-empty" />}
        </div>

        <ul className="reports-distribution-legend">
          {distribution.map((segment) => (
            <li key={segment.key}>
              <span className={`reports-legend-dot ${segment.className}`} />
              {segment.label}
              <strong>{segment.count}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div className="reports-toolbar">
        <div className="reports-search">
          <Search size={17} />
          <input
            aria-label="Search reports"
            type="search"
            placeholder="Search domains, URLs, or threats..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="reports-clear-search"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="reports-date-filter" ref={datePickerRef}>
          <label className="reports-date-filter-label">
            <span>Date range</span>
            <select
              aria-label="Filter reports by date"
              value={dateFilter}
              onChange={(event) =>
                handleDateFilterChange(event.target.value as DateFilter)
              }
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="7days">Last 7 days</option>
              <option value="30days">Last 30 days</option>
              <option value="custom">Custom range…</option>
            </select>
          </label>

          {dateFilter === "custom" && (
            <button
              type="button"
              className="reports-custom-trigger"
              aria-expanded={calendarOpen}
              aria-haspopup="dialog"
              onClick={() =>
                calendarOpen ? setCalendarOpen(false) : openCustomCalendar()
              }
            >
              <CalendarDays size={15} />
              <span>
                {customRangeReady
                  ? `${formatDayLabel(customStart!)} – ${formatDayLabel(customEnd!)}`
                  : "Pick dates"}
              </span>
            </button>
          )}

          {calendarOpen && (
            <div
              className="reports-calendar"
              role="dialog"
              aria-label="Custom date range"
            >
              <div className="reports-calendar-summary">
                <div>
                  <span>From</span>
                  <strong>{draftStart ? formatDayLabel(draftStart) : "Select start"}</strong>
                </div>
                <div>
                  <span>To</span>
                  <strong>{draftEnd ? formatDayLabel(draftEnd) : "Select end"}</strong>
                </div>
              </div>

              <div className="reports-calendar-nav">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() =>
                    setCalendarMonth(
                      (current) =>
                        new Date(current.getFullYear(), current.getMonth() - 1, 1),
                    )
                  }
                >
                  <ChevronLeft size={16} />
                </button>
                <strong>
                  {calendarMonth.toLocaleDateString([], {
                    month: "long",
                    year: "numeric",
                  })}
                </strong>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() =>
                    setCalendarMonth(
                      (current) =>
                        new Date(current.getFullYear(), current.getMonth() + 1, 1),
                    )
                  }
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="reports-calendar-weekdays">
                {WEEKDAY_LABELS.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>

              <div className="reports-calendar-grid">
                {calendarDays.map((cell, index) => {
                  if (!cell.key) {
                    return (
                      <span key={`empty-${index}`} className="reports-calendar-empty" />
                    );
                  }

                  const tone = dayTone(cell.key);
                  const className = [
                    "reports-calendar-day",
                    tone,
                    cell.key === todayKey ? "today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <button
                      key={cell.key}
                      type="button"
                      className={className}
                      onClick={() => handleCalendarDayClick(cell.key!)}
                    >
                      {cell.label}
                    </button>
                  );
                })}
              </div>

              <p className="reports-calendar-hint">
                Click a start date, then an end date.
              </p>

              <div className="reports-calendar-actions">
                <button type="button" className="reports-calendar-secondary" onClick={clearCustomRange}>
                  Clear
                </button>
                <button
                  type="button"
                  className="reports-calendar-primary"
                  disabled={!draftStart || !draftEnd}
                  onClick={applyCustomRange}
                >
                  Apply range
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="reports-export">
          <button
            type="button"
            className="reports-export-btn"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download size={15} />
            CSV
          </button>
          <button
            type="button"
            className="reports-export-btn"
            onClick={exportJson}
            disabled={filtered.length === 0}
          >
            <Download size={15} />
            JSON
          </button>
        </div>
      </div>

      <div className="reports-filters" role="group" aria-label="Filter by risk level">
        {riskFilters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`reports-filter-chip${riskFilter === filter.id ? " active" : ""}`}
            onClick={() => setRiskFilter(filter.id)}
            aria-pressed={riskFilter === filter.id}
          >
            {filter.label}
            <span>{filter.count}</span>
          </button>
        ))}
      </div>

      <div className="reports-workspace">
        <section className="reports-list-panel" aria-label="Scan report list">
          <div className="reports-list-meta" aria-live="polite">
            {filtered.length} of {entries.length} reports
          </div>

          {loading ? (
            <div className="reports-empty">
              <div className="reports-skeleton" />
              <div className="reports-skeleton" />
              <div className="reports-skeleton short" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="reports-empty">
              <AlertTriangle size={22} />
              <strong>No reports in this view</strong>
              <p>
                {dateFilter === "custom" && !customRangeReady
                  ? "Choose a start and end date in the calendar to load reports for that range."
                  : entries.length > 0 && search.trim()
                    ? `Nothing matches “${search.trim()}”.`
                    : "Browse with the CyberGuard extension or run a check in Website Tracker to build your report history."}
              </p>
              <Link to="/website-tracker" className="reports-empty-link">
                Open Website Tracker
              </Link>
            </div>
          ) : (
            <ul className="reports-list">
              {filtered.map((entry) => {
                const isSelected = selected?.id === entry.id;
                const riskClass = RISK_CLASS[entry.riskLevel];

                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={`reports-list-item${isSelected ? " selected" : ""}`}
                      onClick={() => setSelectedId(entry.id)}
                      aria-current={isSelected ? "true" : undefined}
                    >
                      <span className={`reports-item-dot ${riskClass}`} />
                      <span className="reports-item-body">
                        <strong>{entry.domain}</strong>
                        <span>{formatDateTime(entry.visitedAt)}</span>
                      </span>
                      <span className={`reports-risk ${riskClass}`}>
                        {RISK_LABELS[entry.riskLevel]}
                      </span>
                      <span className="reports-item-score">{entry.riskScore}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="reports-detail-panel" aria-label="Selected report details">
          {!selected ? (
            <div className="reports-detail-empty">
              <FileText size={28} />
              <p>Select a scan to read its summary.</p>
            </div>
          ) : (
            <>
              <div className="reports-detail-header">
                <div>
                  <p className="reports-detail-label">Scan summary</p>
                  <h2>{selected.domain}</h2>
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="reports-detail-url"
                  >
                    {selected.url}
                  </a>
                </div>
                <span className={`reports-risk ${RISK_CLASS[selected.riskLevel]}`}>
                  {RISK_LABELS[selected.riskLevel]}
                </span>
              </div>

              <div className="reports-detail-metrics">
                <div>
                  <span>Risk score</span>
                  <strong>{selected.riskScore}</strong>
                </div>
                <div>
                  <span>Scanned</span>
                  <strong>{formatDateTime(selected.visitedAt)}</strong>
                </div>
                <div>
                  <span>Source</span>
                  <strong>
                    {selected.source === "GOOGLE_WEB_RISK"
                      ? "Google Web Risk"
                      : "Unable to Verify"}
                  </strong>
                </div>
              </div>

              <div className="reports-detail-section">
                <h3>Threats detected</h3>
                {selected.threatTypes.length === 0 ? (
                  <p className="reports-muted">No specific threat types recorded for this scan.</p>
                ) : (
                  <ul className="reports-threat-list">
                    {selected.threatTypes.map((threat) => (
                      <li key={threat}>{formatThreat(threat)}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="reports-detail-section">
                <h3>Explanation</h3>
                {selected.explanation.length === 0 ? (
                  <p className="reports-muted">No explanation was returned for this scan.</p>
                ) : (
                  <ul className="reports-explanation-list">
                    {selected.explanation.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="reports-related">
        <h2>Related tools</h2>
        <div className="reports-related-grid">
          <Link to="/website-tracker" className="reports-related-card">
            <Globe2 size={20} />
            <div>
              <strong>Website Tracker</strong>
              <p>Browse and manage raw site history.</p>
            </div>
          </Link>
          <Link to="/email-scanner" className="reports-related-card">
            <Mail size={20} />
            <div>
              <strong>Email Scanner</strong>
              <p>Analyze messages for phishing risk.</p>
            </div>
          </Link>
          <Link to="/security-checker" className="reports-related-card">
            <ShieldCheck size={20} />
            <div>
              <strong>Security Checker</strong>
              <p>Run a quick link or URL check.</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Reports;
