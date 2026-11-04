import { useEffect, useState } from "react";
import {
  Network,
  Search,
  ChevronDown,
  ChevronUp,
  Info,
  Globe2,
  Monitor,
  Wifi,
  Radio,
} from "lucide-react";

const API_URL = "http://127.0.0.1:8765";

type NetworkConnection = {
  pid: number;
  protocol: string;
  local_ip: string | null;
  local_port: number | null;
  remote_ip: string | null;
  remote_port: number | null;
  status: string;
};

type ProcessInfo = {
  pid: number;
  name: string;
};

type Props = {
  processes: ProcessInfo[];
};

type ViewMode = "simple" | "technical";

type ConnectionFilter =
  | "all"
  | "connected"
  | "listening"
  | "local"
  | "other";

function isLoopback(ip: string | null) {
  if (!ip) return false;

  const value = ip.toLowerCase();

  return (
    value === "127.0.0.1" ||
    value.startsWith("127.") ||
    value === "::1" ||
    value === "0:0:0:0:0:0:0:1" ||
    value.startsWith("::ffff:127.")
  );
}

function isPrivateAddress(ip: string | null) {
  if (!ip) return false;

  const value = ip.toLowerCase();

  if (isLoopback(value)) return true;

  // IPv4 private and link-local ranges.
  const parts = value.split(".").map(Number);

  if (
    parts.length === 4 &&
    parts.every(
      (part) =>
        Number.isInteger(part) &&
        part >= 0 &&
        part <= 255
    )
  ) {
    const [a, b] = parts;

    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  // IPv6 unique-local and link-local addresses.
  const first = value.split(":")[0];

  if (/^[0-9a-f]{1,4}$/.test(first)) {
    const group = parseInt(first, 16);

    return (
      (group & 0xfe00) === 0xfc00 ||
      (group & 0xffc0) === 0xfe80
    );
  }

  return false;
}

function getConnectionType(
  connection: NetworkConnection
) {
  const remote = connection.remote_ip;

  if (!remote) {
    return "listening";
  }

  if (isLoopback(remote)) {
    return "computer";
  }

  if (isPrivateAddress(remote)) {
    return "local-network";
  }

  return "remote";
}

function getConnectionTypeLabel(
  connection: NetworkConnection
) {
  const type = getConnectionType(connection);

  if (type === "computer") {
    return "This Computer";
  }

  if (type === "local-network") {
    return "Local Network";
  }

  if (type === "listening") {
    return "No Remote Address";
  }

  return "Remote Address";
}

function getStatusLabel(status: string) {
  switch (status.toUpperCase()) {
    case "ESTABLISHED":
      return "Connected";
    case "LISTEN":
    case "LISTENING":
      return "Waiting for Connections";
    case "TIME_WAIT":
      return "Recently Closed";
    case "CLOSE_WAIT":
      return "Closing Connection";
    case "SYN_SENT":
      return "Connecting";
    case "SYN_RECV":
      return "Connection Requested";
    case "FIN_WAIT1":
    case "FIN_WAIT2":
    case "LAST_ACK":
    case "CLOSING":
      return "Closing Connection";
    case "NONE":
      return "Status Not Available";
    default:
      return status.replaceAll("_", " ");
  }
}

function getStatusCategory(status: string) {
  const value = status.toUpperCase();

  if (value === "ESTABLISHED") {
    return "connected";
  }

  if (value === "LISTEN" || value === "LISTENING") {
    return "listening";
  }

  return "other";
}

function getConnectionExplanation(
  connection: NetworkConnection
) {
  const status = connection.status.toUpperCase();
  const type = getConnectionType(connection);

  if (status === "LISTEN" || status === "LISTENING") {
    return (
      "This application has opened a network port " +
      "and is waiting for incoming connections. " +
      "This is common for servers and background services."
    );
  }

  if (status === "TIME_WAIT") {
    return (
      "This TCP connection recently closed. " +
      "The operating system is temporarily retaining " +
      "its connection information."
    );
  }

  if (status === "ESTABLISHED") {
    if (type === "computer") {
      return (
        "This application is communicating with " +
        "another service on the same computer."
      );
    }

    if (type === "local-network") {
      return (
        "This application is connected to an address " +
        "typically used within a private or local network."
      );
    }

    return (
      "This application has an active connection " +
      "to a remote network address."
    );
  }

  if (connection.protocol.toUpperCase() === "UDP") {
    return (
      "This is a UDP network endpoint. UDP does not " +
      "use the same connection states as TCP."
    );
  }

  return (
    "This is a network connection or endpoint " +
    "observed by CyberGuard."
  );
}

function formatAddress(
  ip: string | null,
  port: number | null
) {
  if (!ip) return "Not available";

  const address = ip.includes(":") ? `[${ip}]` : ip;

  return port !== null
    ? `${address}:${port}`
    : address;
}

function connectionKey(connection: NetworkConnection) {
  return [
    connection.pid,
    connection.protocol,
    connection.local_ip ?? "",
    connection.local_port ?? "",
    connection.remote_ip ?? "",
    connection.remote_port ?? "",
    connection.status,
  ].join("|");
}

export default function ProcessNetworkActivity({
  processes,
}: Props) {
  const [connections, setConnections] = useState<
    NetworkConnection[]
  >([]);

  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] =
    useState<ViewMode>("simple");
  const [filter, setFilter] =
    useState<ConnectionFilter>("all");
  const [expandedConnections, setExpandedConnections] =
    useState<Set<string>>(() => new Set());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restricted, setRestricted] = useState(false);

  useEffect(() => {
    let active = true;
    let fetching = false;

    const loadConnections = async () => {
      if (fetching) return;
      fetching = true;

      try {
        const response = await fetch(
          `${API_URL}/system/network-connections`
        );

        if (!response.ok) {
          throw new Error("Network request failed.");
        }

        const data: {
          connections: NetworkConnection[];
          total: number;
          restricted: boolean;
        } = await response.json();

        if (active) {
          setConnections(data.connections);
          setRestricted(data.restricted);
          setError("");
        }
      } catch {
        if (active) {
          setError("Unable to load network connections.");
        }
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    };

    loadConnections();

    const interval = window.setInterval(
      loadConnections,
      10000
    );

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const processNames = new Map(
    processes.map((process) => [
      process.pid,
      process.name,
    ])
  );

  const getProcessName = (pid: number) => {
    if (pid === 0) {
      return "Unknown Process";
    }

    return processNames.get(pid) ?? "Unknown Process";
  };

  const filteredConnections = connections.filter(
    (connection) => {
      const query = search.trim().toLowerCase();

      const processName = getProcessName(connection.pid);

      const matchesSearch =
        !query ||
        processName.toLowerCase().includes(query) ||
        String(connection.pid).includes(query) ||
        (connection.remote_ip ?? "")
          .toLowerCase()
          .includes(query) ||
        (connection.local_ip ?? "")
          .toLowerCase()
          .includes(query) ||
        connection.protocol.toLowerCase().includes(query);

      let matchesFilter = true;

      if (filter === "connected") {
        matchesFilter =
          getStatusCategory(connection.status) ===
          "connected";
      }

      if (filter === "listening") {
        matchesFilter =
          getStatusCategory(connection.status) ===
          "listening";
      }

      if (filter === "local") {
        matchesFilter =
          getConnectionType(connection) === "computer" ||
          getConnectionType(connection) === "local-network";
      }

      if (filter === "other") {
        matchesFilter =
          getStatusCategory(connection.status) === "other";
      }

      return matchesSearch && matchesFilter;
    }
  );

  const toggleExpanded = (key: string) => {
    setExpandedConnections((previous) => {
      const next = new Set(previous);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  return (
    <div className="guardian-section-card guardian-network-card">
      <div className="guardian-section-header">
        <div>
          <h2>Application Network Activity</h2>
          <p>
            See which applications are communicating
            over your network.
          </p>
        </div>

        <Network size={20} />
      </div>

      <div className="guardian-network-controls">
        <div
          className="guardian-network-view-toggle"
          role="group"
          aria-label="Network display mode"
        >
          <button
            type="button"
            className={
              viewMode === "simple" ? "active" : ""
            }
            aria-pressed={viewMode === "simple"}
            onClick={() => setViewMode("simple")}
          >
            Simple View
          </button>

          <button
            type="button"
            className={
              viewMode === "technical" ? "active" : ""
            }
            aria-pressed={viewMode === "technical"}
            onClick={() => setViewMode("technical")}
          >
            Technical View
          </button>
        </div>

        <div className="guardian-network-search">
          <Search size={17} />

          <input
            type="search"
            placeholder="Search application, PID, or IP..."
            aria-label="Search network connections"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>

        <select
          value={filter}
          aria-label="Filter network connections"
          onChange={(event) =>
            setFilter(
              event.target.value as ConnectionFilter
            )
          }
        >
          <option value="all">All Connections</option>
          <option value="connected">Connected</option>
          <option value="listening">Listening</option>
          <option value="local">Local Connections</option>
          <option value="other">Other States</option>
        </select>

        <span className="guardian-network-count">
          {filteredConnections.length} connections
        </span>
      </div>

      {restricted && (
        <p className="guardian-process-message">
          Some network information may be restricted
          by your operating system.
        </p>
      )}

      {error && (
        <p
          className="guardian-process-message"
          role="alert"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="guardian-process-message">
          Loading network connections...
        </p>
      ) : filteredConnections.length === 0 ? (
        <p className="guardian-process-message">
          No matching network connections found.
        </p>
      ) : viewMode === "simple" ? (
        <div className="guardian-network-simple-list">
          {filteredConnections.map(
            (connection, index) => {
              const key = connectionKey(connection);
              const expanded =
                expandedConnections.has(key);

              const statusCategory =
                getStatusCategory(connection.status);

              const type =
                getConnectionType(connection);

              return (
                <div
                  key={`${key}-${index}`}
                  className="guardian-network-simple-item"
                >
                  <div className="guardian-network-simple-icon">
                    {type === "computer" ? (
                      <Monitor size={20} />
                    ) : type === "listening" ? (
                      <Radio size={20} />
                    ) : type === "local-network" ? (
                      <Wifi size={20} />
                    ) : (
                      <Globe2 size={20} />
                    )}
                  </div>

                  <div className="guardian-network-simple-content">
                    <div className="guardian-network-simple-heading">
                      <strong>
                        {getProcessName(connection.pid)}
                      </strong>

                      <span
                        className={`guardian-network-status ${statusCategory}`}
                      >
                        {getStatusLabel(
                          connection.status
                        )}
                      </span>
                    </div>

                    <p>
                      {getConnectionExplanation(
                        connection
                      )}
                    </p>

                    <div className="guardian-network-simple-meta">
                      <span>
                        {getConnectionTypeLabel(
                          connection
                        )}
                      </span>

                      <span>
                        PID {connection.pid}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="guardian-network-details-button"
                      aria-expanded={expanded}
                      onClick={() =>
                        toggleExpanded(key)
                      }
                    >
                      {expanded ? (
                        <>
                          Hide Details
                          <ChevronUp size={15} />
                        </>
                      ) : (
                        <>
                          View Connection Details
                          <ChevronDown size={15} />
                        </>
                      )}
                    </button>

                    {expanded && (
                      <div className="guardian-network-details">
                        <h4>
                          What does this connection mean?
                        </h4>

                        <p>
                          {getConnectionExplanation(
                            connection
                          )}
                        </p>

                        <div className="guardian-network-detail-grid">
                          <div>
                            <span>Application</span>
                            <strong>
                              {getProcessName(
                                connection.pid
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>Process ID</span>
                            <strong>
                              {connection.pid}
                            </strong>
                          </div>

                          <div>
                            <span>Protocol</span>
                            <strong>
                              {connection.protocol}
                            </strong>
                          </div>

                          <div>
                            <span>Connection state</span>
                            <strong>
                              {connection.status}
                            </strong>
                          </div>

                          <div>
                            <span>Local address</span>
                            <strong>
                              {formatAddress(
                                connection.local_ip,
                                connection.local_port
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>Remote address</span>
                            <strong>
                              {formatAddress(
                                connection.remote_ip,
                                connection.remote_port
                              )}
                            </strong>
                          </div>
                        </div>

                        <p className="guardian-network-disclaimer">
                          CyberGuard displays observed
                          network activity. A connection
                          alone does not establish whether
                          a process is safe or malicious.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            }
          )}
        </div>
      ) : (
        <div className="guardian-network-table-wrapper">
          <table className="guardian-process-table">
            <thead>
              <tr>
                <th>Process</th>
                <th>PID</th>
                <th>Protocol</th>
                <th>Local Address</th>
                <th>Remote Address</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredConnections.map(
                (connection, index) => (
                  <tr
                    key={`${connectionKey(connection)}-${index}`}
                  >
                    <td>
                      {getProcessName(connection.pid)}
                    </td>

                    <td>{connection.pid}</td>

                    <td>{connection.protocol}</td>

                    <td>
                      {formatAddress(
                        connection.local_ip,
                        connection.local_port
                      )}
                    </td>

                    <td>
                      {formatAddress(
                        connection.remote_ip,
                        connection.remote_port
                      )}
                    </td>

                    <td>{connection.status}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}