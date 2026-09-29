import { useState } from "react";
import { Search, Globe2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

type Website = {
  domain: string;
  url: string;
  riskScore: number;
  riskLevel: "Safe" | "Suspicious" | "High Risk";
  timeVisited: string;
};

type SortField = "domain" | "riskScore" | "riskLevel" | "timeVisited";
type SortDirection = "asc" | "desc";

const websites: Website[] = [
  {
    domain: "github.com",
    url: "https://github.com",
    riskScore: 4,
    riskLevel: "Safe",
    timeVisited: "2:47 PM",
  },
  {
    domain: "gmail.com",
    url: "https://mail.google.com",
    riskScore: 3,
    riskLevel: "Safe",
    timeVisited: "2:31 PM",
  },
  {
    domain: "paypal-secure.net",
    url: "http://paypal-secure.net/login",
    riskScore: 91,
    riskLevel: "High Risk",
    timeVisited: "1:58 PM",
  },
  {
    domain: "amazon.com",
    url: "https://amazon.com",
    riskScore: 6,
    riskLevel: "Safe",
    timeVisited: "1:44 PM",
  },
  {
    domain: "free-gift-cards24.com",
    url: "http://free-gift-cards24.com",
    riskScore: 74,
    riskLevel: "Suspicious",
    timeVisited: "1:22 PM",
  },
  {
    domain: "notion.so",
    url: "https://notion.so",
    riskScore: 8,
    riskLevel: "Safe",
    timeVisited: "12:55 PM",
  },
  {
    domain: "youtube.com",
    url: "https://youtube.com",
    riskScore: 5,
    riskLevel: "Safe",
    timeVisited: "12:30 PM",
  },
];

function WebsiteTracker() {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] =
  useState<SortDirection>("asc");
  const { session } = useAuth();


  const handleSort = (field: SortField) => {
  if (sortField !== field) {
    // ascending sort
    setSortField(field);
    setSortDirection("asc");
  } else if (sortDirection === "asc") {
    //decsending sort
    setSortDirection("desc");
  } else {
    //orginal sort
    setSortField(null);
    setSortDirection("asc");
  }
};

  const filteredWebsites = websites
    .filter((website) =>
      website.domain.toLowerCase().includes(search.toLowerCase())
    )
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
          Safe: 1,
          Suspicious: 2,
          "High Risk": 3,
        };

        comparison =
          riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      }

      if (sortField === "timeVisited") {
        comparison =
          new Date(`1/1/2026 ${a.timeVisited}`).getTime() -
          new Date(`1/1/2026 ${b.timeVisited}`).getTime();
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

  const safeCount = websites.filter(
    (website) => website.riskLevel === "Safe"
  ).length;

  const suspiciousCount = websites.filter(
    (website) => website.riskLevel === "Suspicious"
  ).length;

  const highRiskCount = websites.filter(
    (website) => website.riskLevel === "High Risk"
  ).length;

  const getRiskClass = (riskLevel: Website["riskLevel"]) => {
    if (riskLevel === "Safe") {
      return "safe";
    }

    if (riskLevel === "Suspicious") {
      return "suspicious";
    }

    return "danger";
  };

  return (
    <div className="website-tracker">

      {/* page heading */}
      <div className="tracker-header">
        <div>
          <h1>Website Tracker</h1>
          <p>
            View websites monitored by the CyberGuard browser extension.
          </p>
        </div>

        <div className="monitoring-status">
          <span className="monitoring-dot"></span>
          Tracking Active
        </div>
      </div>

      {/* guest notice - later only show this when user is logged out */}
      {!session && (
      <div className="tracker-guest-message">
        <Globe2 size={18} />

        <div>
          <strong>Guest Mode</strong>
          <p>
            Website activity is available during this session but will not
            be saved.
          </p>
        </div>
      </div>
      )}

      {/* totals */}
      <div className="tracker-stats">
        <div className="tracker-stat">
          <span>Total Websites</span>
          <strong>{websites.length}</strong>
        </div>

        <div className="tracker-stat">
          <span>Safe</span>
          <strong className="safe-text">{safeCount}</strong>
        </div>

        <div className="tracker-stat">
          <span>Suspicious</span>
          <strong className="suspicious-text">
            {suspiciousCount}
          </strong>
        </div>

        <div className="tracker-stat">
          <span>High Risk</span>
          <strong className="danger-text">{highRiskCount}</strong>
        </div>
      </div>

      {/* search */}
      <div className="tracker-search">
        <Search size={17} />

        <input
          type="text"
          placeholder="Search websites..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {/* website list */}
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
      </div>

        {filteredWebsites.map((website) => {
          const riskClass = getRiskClass(website.riskLevel);

          return (
            <div className="tracker-row" key={website.domain}>

              <div className="tracker-domain">
                <span className={`tracker-dot ${riskClass}`}></span>

                <div>
                  <strong>{website.domain}</strong>
                  <p>{website.url}</p>
                </div>
              </div>

              <div className="tracker-score">
                <strong>{website.riskScore}</strong>

                <div className="score-bar">
                  <div
                    className={`score-fill ${riskClass}`}
                    style={{ width: `${website.riskScore}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <span className={`tracker-risk ${riskClass}`}>
                  {website.riskLevel}
                </span>
              </div>

              <div className="tracker-time">
                {website.timeVisited}
              </div>

            </div>
          );
        })}

        {filteredWebsites.length === 0 && (
          <div className="tracker-empty">
            No websites found.
          </div>
        )}

      </div>
    </div>
  );
}

export default WebsiteTracker;