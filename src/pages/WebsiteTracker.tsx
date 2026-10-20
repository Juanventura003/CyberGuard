import { useEffect, useRef, useState } from "react";
import { Search, Globe2, X, Trash2 } from "lucide-react";
import {
  deleteAllWebsiteHistory,
  deleteWebsiteHistory,
  syncWebsiteHistory,
  type WebsiteHistoryEntry,
} from "../api/emailApi";
import WebsiteFindingDialog, {
  type WebsiteFindingPreview,
} from "../components/WebsiteFindingDialog";
import { normalizeFindingDomain } from "../lib/organizationFindings";
import { useAuth } from "../context/AuthContext";

import { prepareHistoryDeletion } from "../lib/extensionBridge";
import { mergeHistorySnapshot } from "../lib/websiteHistory";

type Website = {
  id?: string;
  domain: string;
  url: string;
  riskScore: number;
  riskLevel:
    | "No Known Threat"
    | "Suspicious"
    | "High Risk"
    | "Unable to Verify";
  visitedAt: string;
  timeVisited: string;
  explanation: string[];
};

type SortField = "domain" | "riskScore" | "riskLevel" | "timeVisited";
type SortDirection = "asc" | "desc";
type DateFilter = "all" | "today" | "7days" | "30days";
type UrlTooltip = { url: string; x: number; y: number } | null;

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

const requestBlocking = (domain?: string, blocked?: boolean) =>
  new Promise<{ domains: string[]; monitoringEnabled: boolean | null }>(
    (resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", receive);
        reject(
          new Error(
            "Reload the extension and this page to connect blocking controls.",
          ),
        );
      }, 4000);
      function receive(event: MessageEvent) {
        if (
          event.source !== window ||
          event.origin !== window.location.origin ||
          event.data?.type !== "CYBERGUARD_BLOCKING_RESPONSE" ||
          event.data.requestId !== requestId
        )
          return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", receive);
        if (event.data.error || !Array.isArray(event.data.state?.domains))
          reject(new Error(event.data.error ?? "Extension unavailable."));
        else
          resolve({
            domains: event.data.state.domains,
            monitoringEnabled:
              typeof event.data.state.monitoringEnabled === "boolean"
                ? event.data.state.monitoringEnabled
                : null,
          });
      }
      window.addEventListener("message", receive);
      window.postMessage(
        { type: "CYBERGUARD_BLOCKING_REQUEST", requestId, domain, blocked },
        window.location.origin,
      );
    },
  );

function WebsiteTracker() {
  const [blockedDomains, setBlockedDomains] = useState<string[] | null>(null);
  const [blockingConnecting, setBlockingConnecting] = useState(true);
  const [blockingError, setBlockingError] = useState("");
  const [blockingBusy, setBlockingBusy] = useState<string | null>(null);
  const [monitoringEnabled, setMonitoringEnabled] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let requestInFlight = false;
    async function refreshBlocking() {
      if (!active || document.hidden || requestInFlight) return;
      requestInFlight = true;
      try {
        const state = await requestBlocking();
        if (active) {
          setBlockedDomains(state.domains);
          setMonitoringEnabled(state.monitoringEnabled);
        }
      } catch {
        if (active) {
          setBlockedDomains(null);
          setMonitoringEnabled(null);
        }
      } finally {
        requestInFlight = false;
        if (active) setBlockingConnecting(false);
      }
    }
    const updatePolling = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      void refreshBlocking();
      timer = window.setInterval(() => {
        void refreshBlocking();
      }, 5000);
    };
    updatePolling();
    document.addEventListener("visibilitychange", updatePolling);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updatePolling);
    };
  }, []);

  async function changeBlocking(domain: string, blocked: boolean) {
    setBlockingBusy(domain);
    setBlockingError("");
    try {
      const state = await requestBlocking(domain, blocked);
      setBlockedDomains(state.domains);
      setMonitoringEnabled(state.monitoringEnabled);
    } catch (error) {
      setBlockingError(
        error instanceof Error ? error.message : "Could not change blocking.",
      );
    } finally {
      setBlockingBusy(null);
    }
  }

  const [selectedFinding, setSelectedFinding] =
    useState<WebsiteFindingPreview | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("timeVisited");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [urlTooltip, setUrlTooltip] = useState<UrlTooltip>(null);
  const { session } = useAuth();
  const historyMutation = useRef(0);

  useEffect(() => {
    setWebsites([]);
    setSelectedFinding(null);
    setHistoryError("");
  }, [session?.user.id]);

  useEffect(() => {
    let ignore = false;
    let timer: number | undefined;
    let requestInFlight = false;
    let cachedEntries = new Map<string, WebsiteHistoryEntry>();

    const loadWebsites = async () => {
      if (ignore || document.hidden || requestInFlight) return;
      requestInFlight = true;
      const mutation = historyMutation.current;
      try {
        const delta = await syncWebsiteHistory(
          Object.fromEntries(
            [...cachedEntries].flatMap(([id, entry]) =>
              entry.updated_at ? [[id, entry.updated_at]] : [],
            ),
          ),
          session?.access_token,
          getSinceDate(dateFilter),
        );
        if (ignore || mutation !== historyMutation.current) return;

        cachedEntries = mergeHistorySnapshot(cachedEntries, delta);
        setHistoryError("");
        const history = [...cachedEntries.values()];
        const mapped = history.map((entry) => ({
          id: entry.id,
          domain: entry.domain,
          url: entry.url,
          riskScore: Math.round(entry.risk_score),
          riskLevel: toRiskLevel(entry.risk_level),
          visitedAt: entry.visited_at,
          explanation: [
            ...new Set(
              (entry.explanation ?? [])
                .map((reason) => reason.trim())
                .filter(
                  (reason) =>
                    reason &&
                    !/^[-•\s]+$/.test(reason) &&
                    !reason.startsWith("OpenPhish feed last downloaded:") &&
                    reason !== "Banner is draggable.",
                ),
            ),
          ].filter(
            (reason) =>
              reason !==
                "No known threat or strong URL warning was detected." ||
              !(entry.explanation ?? []).some((item) =>
                item.startsWith("No strong warning was found"),
              ),
          ),
          timeVisited: new Date(entry.visited_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        }));
        const uniqueWebsites = Array.from(
          new Map(
            mapped
              .slice()
              .reverse()
              .map((website) => [website.url, website]),
          ).values(),
        );

        setWebsites(uniqueWebsites);
      } catch (error) {
        if (ignore) return;
        console.error("Could not load website history", error);
        setHistoryError(
          "Could not refresh history. Any displayed rows are from the last successful load. Retrying automatically while this tab is visible.",
        );
      } finally {
        requestInFlight = false;
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    const updatePolling = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      void loadWebsites();
      timer = window.setInterval(() => {
        void loadWebsites();
      }, 15000);
    };

    updatePolling();
    document.addEventListener("visibilitychange", updatePolling);

    return () => {
      ignore = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updatePolling);
    };
  }, [dateFilter, session?.access_token]);

  const handleSort = (field: SortField) => {
    if (sortField !== field) {
      setSortField(field);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else if (field === "timeVisited") {
      setSortDirection("asc");
    } else {
      setSortField("timeVisited");
      setSortDirection("desc");
    }
  };

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredWebsites = websites
    .filter((website) => {
      if (!normalizedSearch) return true;

      return [website.domain, website.url, website.riskLevel].some((value) =>
        value.toLocaleLowerCase().includes(normalizedSearch),
      );
    })
    .sort((a, b) => {
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

  const safeCount = websites.filter(
    (website) => website.riskLevel === "No Known Threat",
  ).length;
  const suspiciousCount = websites.filter(
    (website) => website.riskLevel === "Suspicious",
  ).length;
  const highRiskCount = websites.filter(
    (website) => website.riskLevel === "High Risk",
  ).length;
  const unableToVerifyCount = websites.filter(
    (website) => website.riskLevel === "Unable to Verify",
  ).length;
  const historyUnavailable = Boolean(historyError) && websites.length === 0;

  const getRiskClass = (riskLevel: Website["riskLevel"]) => {
    if (riskLevel === "No Known Threat") return "safe";
    if (riskLevel === "Unable to Verify") return "unable";
    if (riskLevel === "Suspicious") return "suspicious";
    return "danger";
  };

  const handleDelete = async (website: Website) => {
    if (!website.id || !session?.access_token) return;

    try {
      await prepareHistoryDeletion(website.url);
      await deleteWebsiteHistory(website.id, session.access_token, website.url);
      historyMutation.current++;
      setWebsites((current) =>
        current.filter((entry) => entry.url !== website.url),
      );
    } catch (error) {
      console.error("Could not delete website history", error);
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Could not delete website history.",
      );
    }
  };

  const handleDeleteAll = async () => {
    if (!session?.access_token || !websites.length || deletingAll) return;
    if (
      !window.confirm(
        "Delete all saved website history? This cannot be undone.",
      )
    )
      return;

    setDeletingAll(true);
    try {
      await prepareHistoryDeletion();
      await deleteAllWebsiteHistory(session.access_token);
      historyMutation.current++;
      setWebsites([]);
      setSearch("");
    } catch (error) {
      console.error("Could not delete all website history", error);
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Could not delete all website history.",
      );
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

        <div
          className={`monitoring-status${monitoringEnabled === false ? " monitoring-paused" : monitoringEnabled === null ? " monitoring-unavailable" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="monitoring-dot"></span>
          {blockingConnecting
            ? "Connecting to extension…"
            : blockedDomains === null
              ? "Extension not connected"
              : monitoringEnabled === null
                ? "Tracking status unavailable"
                : monitoringEnabled
                  ? "Tracking Active"
                  : "Tracking Paused"}
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
          <strong>{historyUnavailable ? "—" : websites.length}</strong>
        </div>

        <div className="tracker-stat">
          <span>No Known Threat</span>
          <strong className="safe-text">
            {historyUnavailable ? "—" : safeCount}
          </strong>
        </div>

        <div className="tracker-stat">
          <span>Suspicious</span>
          <strong className="suspicious-text">
            {historyUnavailable ? "—" : suspiciousCount}
          </strong>
        </div>

        <div className="tracker-stat">
          <span>High Risk</span>
          <strong className="danger-text">
            {historyUnavailable ? "—" : highRiskCount}
          </strong>
        </div>

        <div className="tracker-stat">
          <span>Unable to Verify</span>
          <strong className="unable-text">
            {historyUnavailable ? "—" : unableToVerifyCount}
          </strong>
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
            onChange={(event) => {
              setDateFilter(event.target.value as DateFilter);
            }}
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

      {historyError && (
        <p role="alert" className="tracker-blocking-error">
          {historyError}
        </p>
      )}

      <p className="tracker-blocking-note" role="status" aria-live="polite">
        {blockingConnecting
          ? "Connecting to extension… Blocking controls will be ready shortly."
          : blockedDomains === null
            ? "Extension not connected. Reload the extension and refresh this page to enable blocking controls."
            : "Blocking is manual and applies in this browser, including subdomains."}
      </p>
      <div className="tracker-checks">
        <strong>What CyberGuard checks</strong>
        <ul>
          <li>
            <strong>URLs:</strong> Google Web Risk, OpenPhish, misleading
            domains, and spelling or Unicode lookalikes.
          </li>
          <li>
            <strong>Pages:</strong> visible password forms and their declared
            destinations, misleading links, and recovery-secret fields.
          </li>
        </ul>
        <p>
          Select <strong>View reasons</strong> for the findings saved with each
          visit.
        </p>
      </div>
      {blockingError && (
        <p role="alert" className="tracker-blocking-error">
          {blockingError}
        </p>
      )}
      <div className="tracker-table">
        <div className="tracker-table-header">
          <button onClick={() => handleSort("domain")}>
            Domain
            {sortField === "domain" && (sortDirection === "asc" ? " ↑" : " ↓")}
          </button>

          <button onClick={() => handleSort("riskScore")}>
            Risk Score
            {sortField === "riskScore" &&
              (sortDirection === "asc" ? " ↑" : " ↓")}
          </button>

          <button onClick={() => handleSort("riskLevel")}>
            Risk Level
            {sortField === "riskLevel" &&
              (sortDirection === "asc" ? " ↑" : " ↓")}
          </button>

          <button onClick={() => handleSort("timeVisited")}>
            Time Visited
            {sortField === "timeVisited" &&
              (sortDirection === "asc" ? " ↑" : " ↓")}
          </button>

          <span>Explanation</span>
          <span>Blocking</span>
          <span>Share with team</span>
          <span>Delete</span>
        </div>

        <div className="tracker-result-count" aria-live="polite">
          {historyUnavailable
            ? "Saved history is unavailable."
            : `${filteredWebsites.length} of ${websites.length} websites shown`}
        </div>

        {loading ? (
          <div className="tracker-empty">
            Loading recent website activity...
          </div>
        ) : filteredWebsites.length === 0 ? (
          <div className="tracker-empty">
            {historyUnavailable
              ? "Could not load saved history. Start the backend to reconnect; this page will retry automatically."
              : websites.length > 0 && normalizedSearch
                ? `No websites match “${search.trim()}”.`
                : "No websites have been scanned yet. Open a page in the browser extension and it will appear here."}
          </div>
        ) : (
          filteredWebsites.map((website) => {
            const riskClass = getRiskClass(website.riskLevel);
            const hostname = new URL(website.url).hostname;
            const findingDomain = (() => {
              try {
                return normalizeFindingDomain(website.url);
              } catch {
                return null;
              }
            })();
            const coveringBlock = blockedDomains?.find(
              (domain) =>
                hostname === domain || hostname.endsWith(`.${domain}`),
            );

            return (
              <div
                className="tracker-row"
                key={
                  website.id ??
                  `${website.domain}-${website.url}-${website.visitedAt}`
                }
              >
                <div className="tracker-domain">
                  <span className={`tracker-dot ${riskClass}`}></span>

                  <div>
                    <strong>{website.domain}</strong>
                    <p
                      tabIndex={0}
                      aria-label={`Full URL: ${website.url}`}
                      onMouseEnter={(event) =>
                        setUrlTooltip({
                          url: website.url,
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }
                      onMouseMove={(event) =>
                        setUrlTooltip({
                          url: website.url,
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }
                      onMouseLeave={() => setUrlTooltip(null)}
                      onFocus={(event) => {
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
                        setUrlTooltip({
                          url: website.url,
                          x: bounds.left,
                          y: bounds.bottom,
                        });
                      }}
                      onBlur={() => setUrlTooltip(null)}
                    >
                      {website.url}
                    </p>
                  </div>
                </div>

                <span className="tracker-score">
                  <span className="tracker-cell-label">Risk score:</span>
                  {website.riskScore}
                </span>

                <span className={`tracker-risk ${riskClass}`}>
                  {website.riskLevel}
                </span>

                <span className="tracker-time">
                  <span className="tracker-cell-label">Visited:</span>
                  {website.timeVisited}
                </span>

                <div className="tracker-explanation">
                  {website.explanation.length ? (
                    <details>
                      <summary
                        aria-label={`Why ${website.domain} is rated ${website.riskLevel}`}
                      >
                        View reasons
                      </summary>
                      <ul>
                        {website.explanation.map((reason, index) => (
                          <li key={index}>
                            <span className="tracker-reason-text">
                              {reason}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <span>No explanation was saved for this visit.</span>
                  )}
                </div>

                <div className="tracker-blocking-cell">
                  <span
                    className={
                      coveringBlock
                        ? "tracker-blocked-label"
                        : "tracker-allowed-label"
                    }
                  >
                    {blockingConnecting
                      ? "Connecting…"
                      : blockedDomains === null
                        ? "Not connected"
                        : coveringBlock
                          ? "Blocked"
                          : "Not blocked"}
                  </span>
                  <button
                    type="button"
                    className={
                      coveringBlock
                        ? "tracker-unblock-button"
                        : "tracker-block-button"
                    }
                    disabled={blockedDomains === null || blockingBusy !== null}
                    aria-label={`${coveringBlock ? "Unblock" : "Block"} ${coveringBlock ?? hostname}`}
                    title={
                      coveringBlock
                        ? `Unblocks ${coveringBlock} and its subdomains`
                        : `Blocks ${hostname} and its subdomains`
                    }
                    onClick={() =>
                      void changeBlocking(
                        coveringBlock ?? hostname,
                        !coveringBlock,
                      )
                    }
                  >
                    {blockingConnecting
                      ? "Connecting…"
                      : blockedDomains === null
                        ? "Unavailable"
                        : blockingBusy === (coveringBlock ?? hostname)
                          ? "Updating…"
                          : coveringBlock
                            ? "Unblock"
                            : "Block"}
                  </button>
                </div>

                <div className="tracker-sharing-cell">
                  <button
                    type="button"
                    className="tracker-finding-action"
                    disabled={!session || !findingDomain}
                    aria-label={`Share finding for ${website.domain} with your team`}
                    onClick={() => {
                      if (findingDomain)
                        setSelectedFinding({
                          domain: findingDomain,
                          verdict: website.riskLevel,
                          score: website.riskScore,
                          reasons: website.explanation,
                          recordedAt: website.visitedAt,
                        });
                    }}
                  >
                    Share with team
                  </button>
                </div>
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

      {selectedFinding && (
        <WebsiteFindingDialog
          finding={selectedFinding}
          onClose={() => setSelectedFinding(null)}
        />
      )}
      {urlTooltip && (
        <div
          className="tracker-url-tooltip"
          style={{ left: `${urlTooltip.x}px`, top: `${urlTooltip.y + 8}px` }}
          role="tooltip"
        >
          {urlTooltip.url}
        </div>
      )}
    </div>
  );
}

export default WebsiteTracker;
