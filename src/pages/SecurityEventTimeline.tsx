import { useEffect, useState } from "react";
import {
  Clock3,
  AlertTriangle,
  Activity,
  ShieldAlert,
  CirclePlay,
  CircleStop,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const API_URL = "http://127.0.0.1:8765";

type SecurityEvent = {
  id: number;
  timestamp: number;
  event_type: string;
  severity: "info" | "warning" | "high";
  message: string;
  pid: number | null;
  process_name: string | null;
};

type ViewMode = "simple" | "technical";

type EventFilter =
  | "all"
  | "started"
  | "stopped"
  | "warning"
  | "high";

function getEventKind(event: SecurityEvent) {
  const type = event.event_type.toLowerCase();

  if (type === "process_started") return "started";
  if (type === "process_ended") return "stopped";

  return "other";
}

function getEventTitle(event: SecurityEvent) {
  const kind = getEventKind(event);
  const name = event.process_name || "A process";

  if (kind === "started") {
    return `${name} started`;
  }

  if (kind === "stopped") {
    return `${name} stopped`;
  }

  return event.event_type
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
}

function getEventExplanation(event: SecurityEvent) {
  const kind = getEventKind(event);

  if (kind === "started") {
    return (
      "CyberGuard detected a newly running process. " +
      "Applications often start additional processes " +
      "to perform background tasks."
    );
  }

  if (kind === "stopped") {
    return (
      "CyberGuard detected that a previously observed " +
      "process is no longer running. Applications and " +
      "background services can stop during normal operation."
    );
  }

  return event.message;
}

function getEventAdvice(event: SecurityEvent) {
  if (event.severity === "high") {
    return (
      "CyberGuard marked this event as high priority. " +
      "Review the related process and its security analysis."
    );
  }

  if (event.severity === "warning") {
    return (
      "CyberGuard marked this event for review. " +
      "Check whether the activity was expected."
    );
  }

  return (
    "This event is informational. It does not, " +
    "by itself, establish that the process is safe " +
    "or malicious."
  );
}

function getSeverityLabel(severity: SecurityEvent["severity"]) {
  if (severity === "high") return "High Priority";
  if (severity === "warning") return "Needs Review";
  return "Informational";
}

function getEventIcon(event: SecurityEvent) {
  if (event.severity === "high") {
    return <ShieldAlert size={20} />;
  }

  if (event.severity === "warning") {
    return <AlertTriangle size={20} />;
  }

  if (getEventKind(event) === "started") {
    return <CirclePlay size={20} />;
  }

  if (getEventKind(event) === "stopped") {
    return <CircleStop size={20} />;
  }

  return <Activity size={20} />;
}

export default function SecurityEventTimeline() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [filter, setFilter] =
    useState<EventFilter>("all");
  const [viewMode, setViewMode] =
    useState<ViewMode>("simple");
  const [expandedEvents, setExpandedEvents] =
    useState<Set<number>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let fetching = false;

    const loadEvents = async () => {
      if (fetching) return;
      fetching = true;

      try {
        const response = await fetch(
          `${API_URL}/system/security-events`
        );

        if (!response.ok) {
          throw new Error("Unable to load events.");
        }

        const data: {
          events: SecurityEvent[];
          total: number;
        } = await response.json();

        if (active) {
          setEvents(data.events);
          setError("");
        }
      } catch {
        if (active) {
          setError(
            "Unable to retrieve security events."
          );
        }
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    };

    loadEvents();

    const interval = window.setInterval(
      loadEvents,
      5000
    );

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const filteredEvents = events.filter((event) => {
    if (filter === "all") return true;

    if (filter === "started") {
      return getEventKind(event) === "started";
    }

    if (filter === "stopped") {
      return getEventKind(event) === "stopped";
    }

    return event.severity === filter;
  });

  const toggleExpanded = (id: number) => {
    setExpandedEvents((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  return (
    <div className="guardian-section-card guardian-activity-card">
      <div className="guardian-section-header">
        <div>
          <h2>Recent Computer Activity</h2>
          <p>
            See which processes have started, stopped,
            or shown unusual activity.
          </p>
        </div>

        <Clock3 size={20} />
      </div>

      <div className="guardian-activity-toolbar">
        <div
          className="guardian-activity-view-toggle"
          role="group"
          aria-label="Activity display mode"
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

        <select
          value={filter}
          onChange={(event) =>
            setFilter(event.target.value as EventFilter)
          }
          aria-label="Filter computer activity"
        >
          <option value="all">All Activity</option>
          <option value="started">Started</option>
          <option value="stopped">Stopped</option>
          <option value="warning">Needs Review</option>
          <option value="high">High Priority</option>
        </select>

        <span className="guardian-activity-count">
          {filteredEvents.length} events
        </span>
      </div>

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
          Loading recent activity...
        </p>
      ) : filteredEvents.length === 0 ? (
        <p className="guardian-process-message">
          No matching activity recorded yet.
        </p>
      ) : (
        <div className="guardian-event-list guardian-activity-list">
          {filteredEvents.map((event) => {
            const expanded =
              expandedEvents.has(event.id);

            const title =
              viewMode === "simple"
                ? getEventTitle(event)
                : event.event_type
                    .replaceAll("_", " ")
                    .replace(/\b\w/g, (letter) =>
                      letter.toUpperCase()
                    );

            return (
              <div
                key={event.id}
                className={`guardian-activity-item ${event.severity}`}
              >
                <div
                  className={`guardian-activity-icon ${event.severity}`}
                >
                  {getEventIcon(event)}
                </div>

                <div className="guardian-activity-content">
                  <div className="guardian-activity-title-row">
                    <strong>{title}</strong>

                    <span
                      className={`guardian-activity-severity ${event.severity}`}
                    >
                      {getSeverityLabel(event.severity)}
                    </span>
                  </div>

                  <p>
                    {viewMode === "simple"
                      ? getEventExplanation(event)
                      : event.message}
                  </p>

                  {viewMode === "technical" && (
                    <div className="guardian-activity-technical">
                      <span>
                        Event: {event.event_type}
                      </span>

                      {event.process_name && (
                        <span>
                          Process: {event.process_name}
                        </span>
                      )}

                      {event.pid !== null && (
                        <span>PID: {event.pid}</span>
                      )}

                      <span>Event ID: {event.id}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className="guardian-activity-details-button"
                    aria-expanded={expanded}
                    onClick={() =>
                      toggleExpanded(event.id)
                    }
                  >
                    {expanded ? (
                      <>
                        Hide Details
                        <ChevronUp size={15} />
                      </>
                    ) : (
                      <>
                        What does this mean?
                        <ChevronDown size={15} />
                      </>
                    )}
                  </button>

                  {expanded && (
                    <div className="guardian-activity-details">
                      <h4>What happened?</h4>
                      <p>
                        {getEventExplanation(event)}
                      </p>

                      <h4>Do I need to do anything?</h4>
                      <p>{getEventAdvice(event)}</p>

                      <h4>Technical details</h4>

                      <div className="guardian-activity-detail-grid">
                        <div>
                          <span>Process</span>
                          <strong>
                            {event.process_name ||
                              "Not available"}
                          </strong>
                        </div>

                        <div>
                          <span>Process ID</span>
                          <strong>
                            {event.pid ?? "Not available"}
                          </strong>
                        </div>

                        <div>
                          <span>Event type</span>
                          <strong>
                            {event.event_type}
                          </strong>
                        </div>

                        <div>
                          <span>Recorded at</span>
                          <strong>
                            {new Date(
                              event.timestamp * 1000
                            ).toLocaleString()}
                          </strong>
                        </div>
                      </div>

                      <p className="guardian-activity-raw-message">
                        Original event: {event.message}
                      </p>
                    </div>
                  )}
                </div>

                <time
                  className="guardian-activity-time"
                  dateTime={new Date(
                    event.timestamp * 1000
                  ).toISOString()}
                >
                  {new Date(
                    event.timestamp * 1000
                  ).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}