import { useEffect, useState } from "react";
import { Search, Globe2, X, Trash2 } from "lucide-react";
import { deleteAllWebsiteHistory, deleteWebsiteHistory, listWebsiteHistory } from "../api/emailApi";
import { useAuth } from "../context/AuthContext";

type Website = {
  id?: string;
  domain: string;
  url: string;
  riskScore: number;
  riskLevel: "No Known Threat" | "Suspicious" | "High Risk" | "Unable to Verify";
  visitedAt: string;
  timeVisited: string;
};

type SortField = "domain" | "riskScore" | "riskLevel" | "timeVisited";
type SortDirection = "asc" | "desc";
type DateFilter = "all" | "today" | "7days" | "30days";

const toRiskLevel = (riskLevel: string): Website["riskLevel"] => {
  if (riskLevel === "HIGH_RISK") return "High Risk";
  if (riskLevel === "SUSPICIOUS") return "Suspicious";
  if (riskLevel === "UNABLE_TO_VERIFY") return "Unable to Verify";
  return "No Known Threat";
};

const getSinceDate = (filter: DateFilter) => {
  if (filter === "all") return undefined;

  const since = new Date();
  if (filter === "today") {
    since.setHours(0, 0, 0, 0);
  } else {
    since.setDate(since.getDate() - (filter === "7days" ? 7 : 30));
  }
  return since.toISOString();
};

function WebsiteTracker() {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingAll, setDeletingAll] = useState(false);
  const { session } = useAuth();

  useEffect(() => {
    let ignore = false;

    const loadWebsites = async () => {
      try {
        const history = await listWebsiteHistory(1000, session?.access_token, getSinceDate(dateFilter));
        if (ignore) return;

        const mapped = history.map((entry) => ({
          id: entry.id,
          domain: entry.domain,
          url: entry.url,
          riskScore: Math.round(entry.risk_score),
          riskLevel: toRiskLevel(entry.risk_level),
          visitedAt: entry.visited_at,
          timeVisited: new Date(entry.visited_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        }));

        setWebsites(mapped);
      } catch (error) {
        console.error("Could not load website history", error);
        setWebsites([]);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    void loadWebsites();
    const timer = window.setInterval(() => {
      void loadWebsites();
    }, 15000);

    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [dateFilter, session?.access_token]);

  const handleSort = (field: SortField) => {
    if (sortField !== field) {
      setSortField(field);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else {
      setSortField(null);
      setSortDirection("asc");
    }
  };

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredWebsites = websites
    .filter((website) => {
      if (!normalizedSearch) return true;

      return [website.domain, website.url, website.riskLevel]
        .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    })
    .sort((a, b) => {
      if (!sortField) {
        return 0;
      }

      let comparison = 0;
      if (sortField === "domain") {
        comparison = a.domain.localeCompare(b.domain);
      }

      if (sortField === "riskScore") {
        comparison = a.riskScore - b.riskScore;
      }

      if (sortField === "riskLevel") {
        const riskOrder = {
          "No Known Threat": 1,
          Suspicious: 2,
          "High Risk": 3,
          "Unable to Verify": 4,
        };

        comparison = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      }

      if (sortField === "timeVisited") {
        comparison = Date.parse(a.visitedAt) - Date.parse(b.visitedAt);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

  const safeCount = websites.filter((website) => website.riskLevel === "No Known Threat").length;
  const suspiciousCount = websites.filter((website) => website.riskLevel === "Suspicious").length;
  const highRiskCount = websites.filter((website) => website.riskLevel === "High Risk").length;
  const unableToVerifyCount = websites.filter((website) => website.riskLevel === "Unable to Verify").length;

  const getRiskClass = (riskLevel: Website["riskLevel"]) => {
    if (riskLevel === "No Known Threat") return "safe";
    if (riskLevel === "Unable to Verify") return "unable";
    if (riskLevel === "Suspicious") return "suspicious";
    return "danger";
  };

  const handleDelete = async (website: Website) => {
    if (!website.id || !session?.access_token) return;

    window.postMessage(
      { type: "CYBERGUARD_HISTORY_DELETE", url: website.url },
      window.location.origin,
    );

    try {
      await deleteWebsiteHistory(website.id, session.access_token, website.url);
      setWebsites((current) => current.filter((entry) => entry.url !== website.url));
    } catch (error) {
      console.error("Could not delete website history", error);
    }
  };

  const handleDeleteAll = async () => {
    if (!session?.access_token || !websites.length || deletingAll) return;
    if (!window.confirm("Delete all saved website history? This cannot be undone.")) return;

    setDeletingAll(true);
    try {
      window.postMessage(
        { type: "CYBERGUARD_HISTORY_DELETE_ALL" },
        window.location.origin,
      );
      await deleteAllWebsiteHistory(session.access_token);
      setWebsites([]);
      setSearch("");
    } catch (error) {
      console.error("Could not delete all website history", error);
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="website-tracker">
      <div className="tracker-header">
        <div>
          <h1>Website Tracker</h1>
          <p>View websites monitored by the CyberGuard browser extension.</p>
        </div>

        <div className="monitoring-status">
          <span className="monitoring-dot"></span>
          Tracking Active
        </div>
      </div>

      {!session && (
        <div className="tracker-guest-message">
          <Globe2 size={18} />

          <div>
            <strong>Guest Mode</strong>
            <p>Sign in to view your saved website history.</p>
          </div>
        </div>
      )}

      <div className="tracker-stats">
        <div className="tracker-stat">
          <span>Total Websites</span>
          <strong>{websites.length}</strong>
        </div>

        <div className="tracker-stat">
          <span>No Known Threat</span>
          <strong className="safe-text">{safeCount}</strong>
        </div>

        <div className="tracker-stat">
          <span>Suspicious</span>
          <strong className="suspicious-text">{suspiciousCount}</strong>
        </div>

        <div className="tracker-stat">
          <span>High Risk</span>
          <strong className="danger-text">{highRiskCount}</strong>
        </div>

        <div className="tracker-stat">
          <span>Unable to Verify</span>
          <strong className="unable-text">{unableToVerifyCount}</strong>
        </div>
      </div>

      <div className="tracker-search">
        <Search size={17} />

        <input
          aria-label="Search website history"
          type="text"
          placeholder="Search domains, URLs, or risk levels..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {search && (
          <button
            type="button"
            className="tracker-clear-search"
            aria-label="Clear website search"
            title="Clear search"
            onClick={() => setSearch("")}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="tracker-controls">
        <label className="tracker-date-filter">
          <span>Date range</span>
          <select
            aria-label="Filter website history by date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value as DateFilter)}
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="7days">Last 7 days</option>
            <option value="30days">Last 30 days</option>
          </select>
        </label>

        <button
          type="button"
          className="tracker-delete-all"
          disabled={!session || !websites.length || deletingAll}
          onClick={() => void handleDeleteAll()}
        >
          <Trash2 size={15} />
          {deletingAll ? "Deleting..." : "Delete all history"}
        </button>
      </div>

      <div className="tracker-table">
        <div className="tracker-table-header">
          <button onClick={() => handleSort("domain")}>
            Domain
            {sortField === "domain" && (sortDirection === "asc" ? " ↑" : " ↓")}
          </button>

          <button onClick={() => handleSort("riskScore")}>
            Risk Score
            {sortField === "riskScore" && (sortDirection === "asc" ? " ↑" : " ↓")}
          </button>

          <button onClick={() => handleSort("riskLevel")}>
            Risk Level
            {sortField === "riskLevel" && (sortDirection === "asc" ? " ↑" : " ↓")}
          </button>

          <button onClick={() => handleSort("timeVisited")}>
            Time Visited
            {sortField === "timeVisited" && (sortDirection === "asc" ? " ↑" : " ↓")}
          </button>

          <span>Actions</span>
        </div>

        <div className="tracker-result-count" aria-live="polite">
          {filteredWebsites.length} of {websites.length} websites shown
        </div>

        {loading ? (
          <div className="tracker-empty">Loading recent website activity...</div>
        ) : filteredWebsites.length === 0 ? (
          <div className="tracker-empty">
            {websites.length > 0 && normalizedSearch
              ? `No websites match “${search.trim()}”.`
              : "No websites have been scanned yet. Open a page in the browser extension and it will appear here."}
          </div>
        ) : (
          filteredWebsites.map((website) => {
            const riskClass = getRiskClass(website.riskLevel);

            return (
              <div className="tracker-row" key={website.id ?? `${website.domain}-${website.url}-${website.visitedAt}`}>
                <div className="tracker-domain">
                  <span className={`tracker-dot ${riskClass}`}></span>

                  <div>
                    <strong>{website.domain}</strong>
                    <p>{website.url}</p>
                  </div>
                </div>

                <span className="tracker-score">{website.riskScore}</span>

                <span className={`tracker-risk ${riskClass}`}>
                  {website.riskLevel}
                </span>

                <span className="tracker-time">{website.timeVisited}</span>

                <button
                  type="button"
                  className="tracker-delete"
                  aria-label={`Delete ${website.domain} history`}
                  title="Delete history entry"
                  disabled={!website.id || !session}
                  onClick={() => void handleDelete(website)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default WebsiteTracker;