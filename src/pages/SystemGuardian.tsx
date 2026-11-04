import { useEffect, useState } from "react";

import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Monitor,
  ShieldCheck,
  RefreshCw,
  Search,
  ArrowUpDown,
  ListFilter,
} from "lucide-react";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import "./SystemGuardian.css";
import SecurityEventTimeline from "./SecurityEventTimeline";
import ProcessNetworkActivity from "./ProcessNetworkActivity";

const API_URL = "http://127.0.0.1:8765";

type SystemStats = {
  operating_system: string;
  cpu: {
    usage_percent: number;
    cores: number | null;
  };
  memory: {
    usage_percent: number;
    total_gb: number;
    used_gb: number;
    available_gb: number;
  };
  disk: {
    usage_percent: number;
    total_gb: number;
    used_gb: number;
    free_gb: number;
  };
  gpu: {
    supported: boolean;
    usage_percent: number | null;
    message: string;
  };
};

type PerformancePoint = {
  time: string;
  cpu: number;
  memory: number;
  gpu: number | null;
};


type ProcessAnalysis = {
  description: string;
  known_description: boolean;
  warnings: string[];
  recommendations: string[];
  high_resource: boolean;
  review_recommended: boolean;
  risk_level: "informational" | "review";
  executable: string | null;
  parent_name: string | null;
  parent_pid: number | null;
  unusual_location: boolean;
  security_concern: boolean;
  risk_score: number;
  risk_level_v2: "low" | "moderate" | "high";
  risk_factors: {
    reason: string;
    points: number;
  }[];
};

type SystemProcess = {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
  username: string | null;
  status: string;
  create_time: number | null;
  parent_pid?: number | null;
  parent_name?: string | null;
  analysis: ProcessAnalysis;
};

type ProcessSummary = {
  total: number;
  high_resource: number;
  review_recommended: number;
  security_concerns: number;
  high_risk: number;
  moderate_risk: number;
};

type ProcessDetails = {
  pid: number;
  name: string;
  username: string | null;
  status: string;
  create_time: number | null;
  executable: string | null;
  command_line: string[] | null;
  memory_mb: number | null;
};

type TerminationEligibility = {
  eligible: boolean;
  reason: string;
  pid?: number;
  name?: string;
  create_time?: number;
};

type TerminationResult = {
  success: boolean;
  message: string;
};

type SortField = "name" | "pid" | "cpu_percent" | "memory_mb";

type ProcessTreeNode = SystemProcess & {
  children: ProcessTreeNode[];
};

type ProcessFamilyTreeProps = {
  processes: SystemProcess[];
  selectedPid: number | null;
  onSelectProcess: (process: SystemProcess) => void;
};
type TreeViewMode = "simple" | "technical";
type TreeFilter = "all" | "review" | "parents";


function ProcessFamilyTree({
  processes,
  selectedPid,
  onSelectProcess,
}: ProcessFamilyTreeProps) {
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set()
  );

  const [viewMode, setViewMode] =
    useState<TreeViewMode>("simple");

  const [filter, setFilter] =
    useState<TreeFilter>("all");

  const [search, setSearch] = useState("");
  const [selectedInfoPid, setSelectedInfoPid] =
    useState<number | null>(null);

  const friendlyNames: Record<string, string> = {
    "explorer.exe": "Windows Explorer",
    "chrome.exe": "Google Chrome",
    "msedge.exe": "Microsoft Edge",
    "firefox.exe": "Mozilla Firefox",
    "notepad.exe": "Notepad",
    "snippingtool.exe": "Snipping Tool",
    "code.exe": "Visual Studio Code",
    "discord.exe": "Discord",
    "spotify.exe": "Spotify",
    "powershell.exe": "PowerShell",
    "cmd.exe": "Command Prompt",
    "finder": "Finder",
    "safari": "Safari",
    "terminal": "Terminal",
  };

  const getFriendlyName = (name: string) =>
    friendlyNames[name.toLowerCase()] ??
    name.replace(/\.exe$/i, "");

  const getRiskLabel = (process: SystemProcess) => {
    switch (process.analysis.risk_level_v2) {
      case "high":
        return "High risk";
      case "moderate":
        return "Needs review";
      default:
        return "Low risk";
    }
  };

  const processMap = new Map<number, ProcessTreeNode>();

  for (const process of processes) {
    processMap.set(process.pid, {
      ...process,
      children: [],
    });
  }

  const roots: ProcessTreeNode[] = [];

  for (const process of processes) {
    const node = processMap.get(process.pid)!;

    const parentPid =
      process.parent_pid ??
      process.analysis?.parent_pid ??
      null;

    const parent =
      parentPid !== null
        ? processMap.get(parentPid)
        : undefined;

    if (
      parent &&
      parent.pid !== node.pid &&
      (
        parent.create_time === null ||
        node.create_time === null ||
        parent.create_time <= node.create_time
      )
    ) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  roots.sort(
    (a, b) => b.children.length - a.children.length
  );

  const matchesFilter = (node: ProcessTreeNode) => {
    const query = search.trim().toLowerCase();

    const matchesSearch =
      !query ||
      node.name.toLowerCase().includes(query) ||
      getFriendlyName(node.name)
        .toLowerCase()
        .includes(query) ||
      String(node.pid).includes(query);

    const matchesCategory =
      filter === "all" ||
      (filter === "review" &&
        (
          node.analysis.risk_level_v2 === "high" ||
          node.analysis.risk_level_v2 === "moderate" ||
          node.analysis.review_recommended
        )) ||
      (filter === "parents" &&
        node.children.length > 0);

    return matchesSearch && matchesCategory;
  };

  const hasVisibleMatch = (
    node: ProcessTreeNode
  ): boolean =>
    matchesFilter(node) ||
    node.children.some(hasVisibleMatch);

  const isFiltering =
    search.trim().length > 0 || filter !== "all";

  const toggleExpanded = (pid: number) => {
    setExpanded((previous) => {
      const next = new Set(previous);

      if (next.has(pid)) next.delete(pid);
      else next.add(pid);

      return next;
    });
  };

  const selectedInfo =
    selectedInfoPid === null
      ? null
      : processes.find(
          (process) => process.pid === selectedInfoPid
        ) ?? null;

  const renderNode = (
    node: ProcessTreeNode,
    depth = 0,
    visited = new Set<number>()
  ): React.ReactNode => {
    if (visited.has(node.pid)) return null;
    if (isFiltering && !hasVisibleMatch(node)) return null;

    const nextVisited = new Set(visited);
    nextVisited.add(node.pid);

    const children = node.children.filter(
      (child) =>
        !isFiltering || hasVisibleMatch(child)
    );

    const hasChildren = children.length > 0;

    const isExpanded =
      isFiltering || expanded.has(node.pid);

    const riskLevel =
      node.analysis.risk_level_v2 ?? "low";

    return (
      <div key={`${node.pid}-${node.create_time}`}>
        <div
          className={`guardian-friendly-node ${
            selectedPid === node.pid ? "selected" : ""
          }`}
          style={{
            marginLeft: `${Math.min(depth, 12) * 18}px`,
          }}
        >
          <button
            type="button"
            className="guardian-friendly-toggle"
            disabled={!hasChildren || isFiltering}
            onClick={() => toggleExpanded(node.pid)}
            aria-label={
              isExpanded
                ? `Collapse ${node.name}`
                : `Expand ${node.name}`
            }
          >
            {hasChildren
              ? isExpanded
                ? "−"
                : "+"
              : "·"}
          </button>

          <button
            type="button"
            className="guardian-friendly-process"
            onClick={() => {
              setSelectedInfoPid(node.pid);
              onSelectProcess(node);
            }}
          >
            <strong>
              {viewMode === "simple"
                ? getFriendlyName(node.name)
                : node.name}
            </strong>

            <span>
              {viewMode === "simple"
                ? `${node.children.length} direct child ${
                    node.children.length === 1
                      ? "process"
                      : "processes"
                  }`
                : `PID ${node.pid} · Parent PID ${
                    node.parent_pid ??
                    node.analysis.parent_pid ??
                    "Unknown"
                  } · ${node.memory_mb.toFixed(1)} MB`}
            </span>
          </button>

          <span
            className={`guardian-friendly-risk ${riskLevel}`}
          >
            {viewMode === "simple"
              ? getRiskLabel(node)
              : `${node.analysis.risk_score}/100`}
          </span>
        </div>

        {hasChildren &&
          isExpanded &&
          children.map((child) =>
            renderNode(
              child,
              depth + 1,
              nextVisited
            )
          )}
      </div>
    );
  };

  const visibleRoots = roots.filter(
    (root) =>
      !isFiltering || hasVisibleMatch(root)
  );

  return (
    <section className="guardian-relationships">
      <div className="guardian-relationships-header">
        <div>
          <h2>Application Relationships</h2>
          <p>
            Explore which applications started other
            programs on your computer.
          </p>
        </div>

        <span>{processes.length} processes</span>
      </div>

      <div className="guardian-tree-controls">
        <div
          className="guardian-view-toggle"
          role="group"
          aria-label="Process tree view"
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

        <input
          type="search"
          placeholder="Search applications or PID..."
          aria-label="Search application relationships"
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
        />

        <select
          value={filter}
          aria-label="Filter application relationships"
          onChange={(event) =>
            setFilter(event.target.value as TreeFilter)
          }
        >
          <option value="all">All Processes</option>
          <option value="review">Needs Review</option>
          <option value="parents">
            Starts Other Processes
          </option>
        </select>
      </div>

      <div className="guardian-friendly-tree">
        {visibleRoots.length === 0 ? (
          <p className="guardian-tree-empty">
            No matching processes found.
          </p>
        ) : (
          visibleRoots.map((root) =>
            renderNode(root)
          )
        )}
      </div>

      {selectedInfo && (
        <div className="guardian-tree-info">
          <div className="guardian-tree-info-header">
            <div>
              <h3>
                {getFriendlyName(selectedInfo.name)}
              </h3>
              <span>{selectedInfo.name}</span>
            </div>

            <button
              type="button"
              onClick={() => setSelectedInfoPid(null)}
              aria-label="Close process information"
            >
              ✕
            </button>
          </div>

          <h4>What is this?</h4>
          <p>
            {selectedInfo.analysis.description ||
              "No description is currently available."}
          </p>

          <h4>Why is it connected to other processes?</h4>
          <p>
            Programs can start other processes to
            perform tasks in the background.
            These connections do not automatically
            indicate a security threat.
          </p>

          <div className="guardian-tree-info-stats">
            <div>
              <span>Risk level</span>
              <strong>
                {getRiskLabel(selectedInfo)}
              </strong>
            </div>

            <div>
              <span>Risk score</span>
              <strong>
                {selectedInfo.analysis.risk_score}/100
              </strong>
            </div>

            <div>
              <span>Started by</span>
              <strong>
                {selectedInfo.analysis.parent_name ||
                  "Unknown"}
              </strong>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SystemGuardian() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [performanceHistory, setPerformanceHistory] = useState<
    PerformancePoint[]
  >([]);
  const [processSummary, setProcessSummary] =
  useState<ProcessSummary | null>(null);

  const [processes, setProcesses] = useState<SystemProcess[]>([]);
  const [processSearch, setProcessSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("memory_mb");
  const [sortDescending, setSortDescending] = useState(true);
  const [processError, setProcessError] = useState("");
  const [processLoading, setProcessLoading] = useState(true);
  const [processScanning, setProcessScanning] = useState(false);

  const [selectedProcess, setSelectedProcess] =
    useState<ProcessDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedProcessAnalysis, setSelectedProcessAnalysis] =
    useState<ProcessAnalysis | null>(null);
  
const [terminationCheck, setTerminationCheck] =
  useState<TerminationEligibility | null>(null);

const [terminationLoading, setTerminationLoading] =
  useState(false);

const [terminationConfirm, setTerminationConfirm] =
  useState(false);

const [terminationMessage, setTerminationMessage] =
  useState("");

  useEffect(() => {
    let active = true;
    let fetching = false;

    const fetchStats = async () => {
      if (fetching) return;

      fetching = true;

      try {
        const response = await fetch(`${API_URL}/system/stats`);

        if (!response.ok) {
          throw new Error("Unable to retrieve system statistics.");
        }

        const data: SystemStats = await response.json();

        if (active) {
          const now = new Date();

          setStats(data);
          setError("");
          setLastUpdated(now);

          setPerformanceHistory((previous) => {
            const next = [
              ...previous,
              {
                time: now.toLocaleTimeString(),
                cpu: data.cpu.usage_percent,
                memory: data.memory.usage_percent,
                gpu: data.gpu.supported
                  ? data.gpu.usage_percent
                  : null,
              },
            ];

            return next.slice(-30);
          });
        }
      } catch {
        if (active) {
          setError(
            "Cannot connect to the local System Guardian scanner."
          );
        }
      } finally {
        fetching = false;
      }
    };

    fetchStats();

    const interval = window.setInterval(fetchStats, 2000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let fetching = false;

    const fetchProcesses = async () => {
      if (fetching) return;

      fetching = true;

      try {
        const response = await fetch(
          `${API_URL}/system/processes`
        );

        if (!response.ok) {
          throw new Error("Unable to retrieve processes.");
        }

        const data: {
          processes: SystemProcess[];
          summary: ProcessSummary;
          scanning: boolean;
          last_updated: number | null;
        } = await response.json();

        if (active) {
          setProcesses(data.processes);
          setProcessSummary(data.summary);
          setProcessScanning(data.scanning);
          setProcessError("");

          if (data.last_updated !== null) {
            setProcessLoading(false);
          }
        }
      } catch {
        if (active) {
          setProcessError("Unable to load running processes.");
        }
      } finally {
        fetching = false;
      }
    };

    fetchProcesses();

    const interval = window.setInterval(fetchProcesses, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const filteredProcesses = processes
    .filter((process) => {
      const query = processSearch.toLowerCase().trim();

      return (
        process.name.toLowerCase().includes(query) ||
        String(process.pid).includes(query) ||
        (process.username ?? "").toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];

      let comparison: number;

      if (
        typeof aValue === "string" &&
        typeof bValue === "string"
      ) {
        comparison = aValue.localeCompare(bValue);
      } else {
        comparison = Number(aValue) - Number(bValue);
      }

      return sortDescending ? -comparison : comparison;
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDescending((previous) => !previous);
    } else {
      setSortField(field);
      setSortDescending(field !== "name");
    }
  };

  const openProcessDetails = async (process: SystemProcess) => {
    setTerminationCheck(null);
    setTerminationConfirm(false);
    setTerminationMessage("");
    setDetailsLoading(true);
    setSelectedProcess(null);
    setSelectedProcessAnalysis(process.analysis);
    setProcessError("");

    try {
      const response = await fetch(
        `${API_URL}/system/processes/${process.pid}`
      );

      if (!response.ok) {
        throw new Error("Unable to retrieve process details.");
      }

      const data: ProcessDetails = await response.json();
      if (
        data.create_time !== null &&
        process.create_time !== null &&
        data.create_time !== process.create_time
      ) {
        throw new Error("The selected process has changed.");
      }

      setSelectedProcess(data);
    } catch {
      setSelectedProcessAnalysis(null);
      setProcessError(
        "Unable to retrieve details. The process may have exited or access may be restricted."
      );
    } finally {
      setDetailsLoading(false);
    }
  };
  
const checkProcessTermination = async (
  process: SystemProcess
) => {
  setTerminationLoading(true);
  setTerminationCheck(null);
  setTerminationConfirm(false);
  setTerminationMessage("");

  if (process.create_time === null) {
    setTerminationCheck({
      eligible: false,
      reason: "Process identity is unavailable.",
    });
    setTerminationLoading(false);
    return;
  }

  try {
    const response = await fetch(
      `${API_URL}/system/processes/termination-check`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pid: process.pid,
          create_time: process.create_time,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Eligibility check failed.");
    }

    const result: TerminationEligibility =
      await response.json();

    console.log("Termination eligibility response:", result);

    setTerminationCheck({
      ...result,
      eligible: result.eligible === true,
      reason:
        result.reason ||
        "The scanner did not provide an eligibility explanation.",
    });
  } catch {
    setTerminationMessage(
      "Unable to check whether this process can be ended."
    );
  } finally {
    setTerminationLoading(false);
  }
};

const confirmProcessTermination = async () => {
  if (
    !selectedProcess ||
    !terminationCheck?.eligible ||
    terminationCheck.create_time === undefined
  ) {
    return;
  }

  setTerminationLoading(true);
  setTerminationMessage("");

  try {
    const response = await fetch(
      `${API_URL}/system/processes/terminate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pid: selectedProcess.pid,
          create_time: terminationCheck.create_time,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Termination request failed.");
    }

    const result: TerminationResult =
      await response.json();

    setTerminationMessage(result.message);

    if (result.success) {
      setTerminationConfirm(false);
      setTerminationCheck(null);
      setSelectedProcess(null);
      setSelectedProcessAnalysis(null);
    }
  } catch {
    setTerminationMessage(
      "Unable to complete the termination request."
    );
  } finally {
    setTerminationLoading(false);
  }
};

  const cards = stats
    ? [
        {
          title: "CPU Usage",
          value: `${stats.cpu.usage_percent}%`,
          percent: stats.cpu.usage_percent,
          detail: `${stats.cpu.cores ?? "Unknown"} logical cores`,
          icon: Cpu,
          color: "#60a5fa",
        },
        {
          title: "Memory",
          value: `${stats.memory.usage_percent}%`,
          percent: stats.memory.usage_percent,
          detail: `${stats.memory.used_gb} / ${stats.memory.total_gb} GB`,
          icon: MemoryStick,
          color: "#a78bfa",
        },
        {
          title: "Disk Storage",
          value: `${stats.disk.usage_percent}%`,
          percent: stats.disk.usage_percent,
          detail: `${stats.disk.used_gb} / ${stats.disk.total_gb} GB`,
          icon: HardDrive,
          color: "#34d399",
        },
        {
          title: "GPU Usage",
          value: stats.gpu.supported
            ? stats.gpu.usage_percent === null
              ? "N/A"
              : `${stats.gpu.usage_percent}%`
            : "N/A",
          percent: stats.gpu.usage_percent ?? 0,
          detail: stats.gpu.supported
            ? "GPU utilization"
            : stats.gpu.message,
          icon: Monitor,
          color: "#94a3b8",
        },
      ]
    : [];

  return (
    <div className="system-guardian-page">
      {/* HEADER */}
      <div className="guardian-topbar">
        <div className="guardian-title-group">
          <div className="guardian-title-icon">
            <ShieldCheck size={26} />
          </div>

          <div>
            <h1>System Guardian</h1>
            <p>
              Real-time system health and security monitoring
            </p>
          </div>
        </div>

        <span
          className={`guardian-connection ${
            error
              ? "disconnected"
              : stats
              ? "connected"
              : ""
          }`}
        >
          <Activity size={14} />
          {error
            ? "Disconnected"
            : stats
            ? "Connected"
            : "Connecting..."}
        </span>
      </div>

      {error && (
        <div className="guardian-error">{error}</div>
      )}

      {stats && (
        <>
          {/* DEVICE INFORMATION */}
          <div className="guardian-toolbar">
            <div className="guardian-os-label">
              <Monitor size={16} />
              <span>
                {stats.operating_system === "Darwin"
                  ? "macOS Device"
                  : `${stats.operating_system} Device`}
              </span>
            </div>

            <div className="guardian-refresh-label">
              <RefreshCw size={14} />
              <span>
                Updated {lastUpdated?.toLocaleTimeString()}
                {" · "}Every 2 seconds
              </span>
            </div>
          </div>

          {/* PERFORMANCE CARDS */}
          <div className="guardian-stats-grid">
            {cards.map((card) => {
              const Icon = card.icon;

              return (
                <div
                  className="guardian-stat-card"
                  key={card.title}
                >
                  <div className="guardian-card-heading">
                    <h3>{card.title}</h3>

                    <div
                      className="guardian-card-icon"
                      style={{ color: card.color }}
                    >
                      <Icon size={22} />
                    </div>
                  </div>

                  <div className="guardian-stat-value">
                    {card.value}
                  </div>

                  <div className="guardian-progress-track">
                    <div
                      className="guardian-progress-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(0, card.percent)
                        )}%`,
                        backgroundColor: card.color,
                      }}
                    />
                  </div>

                  <p>{card.detail}</p>
                </div>
              );
            })}
          </div>

          {/*  PERFORMANCE OVERVIEW*/}

          <div className="guardian-section-card">
            <div className="guardian-section-header">
              <div>
                <h2>Performance Overview</h2>
                <p>
                  Live CPU and memory utilization over
                  the last 60 seconds.
                </p>
              </div>

              <span className="guardian-live-badge">
                <span className="guardian-live-dot" />
                Live Monitoring
              </span>
            </div>

            <div className="guardian-charts-grid">
              {/* CPU GRAPH */}
              <div className="guardian-chart-card">
                <div className="guardian-chart-heading">
                  <div>
                    <h3>CPU Usage History</h3>
                    <p>Processor utilization</p>
                  </div>

                  <span className="guardian-chart-current cpu">
                    {stats.cpu.usage_percent}%
                  </span>
                </div>

                <div className="guardian-chart-container">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <LineChart
                      data={performanceHistory}
                      margin={{
                        top: 10,
                        right: 12,
                        left: -20,
                        bottom: 0,
                      }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e2e8f0"
                        vertical={false}
                      />

                      <XAxis
                        dataKey="time"
                        tick={{
                          fontSize: 11,
                          fill: "#64748b",
                        }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={25}
                      />

                      <YAxis
                        domain={[0, 100]}
                        tick={{
                          fontSize: 11,
                          fill: "#64748b",
                        }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}%`}
                      />

                      <Tooltip
                        formatter={(value) => [
                          `${value}%`,
                          "CPU Usage",
                        ]}
                        contentStyle={{
                          borderRadius: "10px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12px",
                        }}
                      />

                      <Line
                        type="monotone"
                        dataKey="cpu"
                        stroke="#2962e8"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* MEMORY GRAPH */}
              <div className="guardian-chart-card">
                <div className="guardian-chart-heading">
                  <div>
                    <h3>Memory Usage History</h3>
                    <p>RAM utilization</p>
                  </div>

                  <span className="guardian-chart-current memory">
                    {stats.memory.usage_percent}%
                  </span>
                </div>

                <div className="guardian-chart-container">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <LineChart
                      data={performanceHistory}
                      margin={{
                        top: 10,
                        right: 12,
                        left: -20,
                        bottom: 0,
                      }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e2e8f0"
                        vertical={false}
                      />

                      <XAxis
                        dataKey="time"
                        tick={{
                          fontSize: 11,
                          fill: "#64748b",
                        }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={25}
                      />

                      <YAxis
                        domain={[0, 100]}
                        tick={{
                          fontSize: 11,
                          fill: "#64748b",
                        }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}%`}
                      />

                      <Tooltip
                        formatter={(value) => [
                          `${value}%`,
                          "Memory Usage",
                        ]}
                        contentStyle={{
                          borderRadius: "10px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12px",
                        }}
                      />

                      <Line
                        type="monotone"
                        dataKey="memory"
                        stroke="#8b5cf6"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* GPU GRAPH */}
              <div className="guardian-chart-card">
                <div className="guardian-chart-heading">
                  <div>
                    <h3>GPU Usage History</h3>
                    <p>Graphics processor utilization</p>
                  </div>

                  <span className="guardian-chart-current gpu">
                    {stats.gpu.supported &&
                    stats.gpu.usage_percent !== null
                      ? `${stats.gpu.usage_percent}%`
                      : "N/A"}
                  </span>
                </div>

                <div className="guardian-chart-container">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <LineChart
                      data={performanceHistory}
                      margin={{
                        top: 10,
                        right: 12,
                        left: -20,
                        bottom: 0,
                      }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e2e8f0"
                        vertical={false}
                      />

                      <XAxis
                        dataKey="time"
                        tick={{
                          fontSize: 11,
                          fill: "#64748b",
                        }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={25}
                      />

                      <YAxis
                        domain={[0, 100]}
                        tick={{
                          fontSize: 11,
                          fill: "#64748b",
                        }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}%`}
                      />

                      <Tooltip
                        formatter={(value) => [
                          value === null
                            ? "N/A"
                            : `${value}%`,
                          "GPU Usage",
                        ]}
                        contentStyle={{
                          borderRadius: "10px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12px",
                        }}
                      />

                      <Line
                        type="monotone"
                        dataKey="gpu"
                        stroke="#64748b"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

            
            </div>
          </div>

          {/* PROCESS FAMILY TREE*/}

          <ProcessFamilyTree
            processes={processes}
            selectedPid={selectedProcess?.pid ?? null}
            onSelectProcess={openProcessDetails}
          />
          <SecurityEventTimeline />

          <ProcessNetworkActivity processes={processes} />

          {/*BACKGROUND PROCESS MANAGER*/}
          {/* PROCESS SECURITY ANALYSIS */}
            <div className="guardian-section-card">
            <div className="guardian-section-header">
                <div>
                <h2>Process Security Analysis</h2>
                <p>
                    Resource monitoring and recommendations for running processes.
                </p>
                </div>
            </div>

            <div className="guardian-analysis-grid">
                <div className="guardian-analysis-stat">
                <span>Processes Monitored</span>
                <strong>{processSummary?.total ?? 0}</strong>
                </div>

                <div className="guardian-analysis-stat">
                <span>High Resource Usage</span>
                <strong>{processSummary?.high_resource ?? 0}</strong>
                </div>

                <div className="guardian-analysis-stat">
                  <span>Potential Security Concerns</span>
                  <strong>{processSummary?.security_concerns ?? 0}</strong>
                </div>

                <div className="guardian-analysis-stat">
                <span>Review Recommended</span>
                <strong>{processSummary?.review_recommended ?? 0}</strong>
                </div>
            </div>
            </div>
          <div className="guardian-section-card">
            <div className="guardian-section-header">
              <div>
                <h2>Background Processes</h2>
                <p>
                  Monitor applications and services running
                  on your computer.
                </p>
              </div>

              <span className="guardian-process-count">
                {filteredProcesses.length} Processes
              </span>
            </div>

            {/* SEARCH AND SORT */}
            <div className="guardian-process-toolbar">
              <div className="guardian-process-search">
                <Search size={17} />

                <input
                  type="text"
                  placeholder="Search by name, PID, or user..."
                  value={processSearch}
                  onChange={(event) =>
                    setProcessSearch(event.target.value)
                  }
                />
              </div>

              <div className="guardian-process-sort">
                <ListFilter size={16} />

                <select
                  value={sortField}
                  onChange={(event) => {
                    const field =
                      event.target.value as SortField;

                    setSortField(field);
                    setSortDescending(field !== "name");
                  }}
                  aria-label="Sort processes"
                >
                  <option value="memory_mb">
                    Memory Usage
                  </option>
                  <option value="cpu_percent">
                    CPU Usage
                  </option>
                  <option value="name">
                    Process Name
                  </option>
                  <option value="pid">
                    PID
                  </option>
                </select>
              </div>
            </div>

            {/* PROCESS ERRORS */}
            {processError && (
              <div className="guardian-error">
                {processError}
              </div>
            )}

            {/* PROCESS TABLE */}
            {processLoading ? (
              <p className="guardian-process-message">
                {processScanning
                  ? "Collecting and analyzing running processes..."
                  : "Connecting to process scanner..."}
              </p>
            ) : (
              <div className="guardian-process-table-wrapper">
                <table className="guardian-process-table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          onClick={() => handleSort("name")}
                        >
                          Process Name
                          <ArrowUpDown size={13} />
                        </button>
                      </th>

                      <th>
                        <button
                          type="button"
                          onClick={() => handleSort("pid")}
                        >
                          PID
                          <ArrowUpDown size={13} />
                        </button>
                      </th>

                      <th>
                        <button
                          type="button"
                          onClick={() =>
                            handleSort("cpu_percent")
                          }
                        >
                          CPU
                          <ArrowUpDown size={13} />
                        </button>
                      </th>

                      <th>
                        <button
                          type="button"
                          onClick={() =>
                            handleSort("memory_mb")
                          }
                        >
                          Memory
                          <ArrowUpDown size={13} />
                        </button>
                      </th>

                    <th>Status</th>
                    <th>Analysis</th>
                    <th>Risk Score</th>
                    <th>Details</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredProcesses.map((process) => (
                      <tr
                        key={`${process.pid}-${process.create_time}`}
                      >
                        <td className="guardian-process-name">
                          {process.name}
                        </td>

                        <td>{process.pid}</td>

                        <td>
                          {process.cpu_percent.toFixed(1)}%
                        </td>

                        <td>
                          {process.memory_mb.toFixed(1)} MB
                        </td>

                        <td>
                          <span className="guardian-process-status">
                            {process.status}
                          </span>
                        </td>

                        <td>
                        {process.analysis.high_resource ? (
                            <span className="guardian-analysis-warning">
                            Review Resources
                            </span>
                        ) : (
                            <span className="guardian-analysis-normal">
                            No Resource Alert
                            </span>
                        )}
                        </td>

                        <td>
                          <span
                            className={`guardian-risk-badge ${
                              process.analysis.risk_level_v2
                            }`}
                          >
                            {process.analysis.risk_score}/100
                            {" · "}
                            {process.analysis.risk_level_v2}
                          </span>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="guardian-details-button"
                            onClick={() =>
                              openProcessDetails(process)
                            }
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredProcesses.length === 0 && (
                  <p className="guardian-process-message">
                    No matching processes found.
                  </p>
                )}
              </div>
            )}

            {/* PROCESS DETAILS */}
            {(selectedProcess || detailsLoading) && (
              <div className="guardian-process-details">
                <div className="guardian-details-header">
                  <h3>Process Details</h3>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProcess(null);
                      setSelectedProcessAnalysis(null);
                      setTerminationCheck(null);
                      setTerminationConfirm(false);
                      setTerminationMessage("");
                    }}
                    disabled={detailsLoading}
                  >
                    Close
                  </button>
                </div>

                {detailsLoading ? (
                  <p>Loading details...</p>
                ) : (
                  selectedProcess && (
                    <div className="guardian-details-grid">
                      <p>
                        <strong>Name:</strong>{" "}
                        {selectedProcess.name}
                      </p>

                      <p>
                        <strong>PID:</strong>{" "}
                        {selectedProcess.pid}
                      </p>

                      <p>
                        <strong>Status:</strong>{" "}
                        {selectedProcess.status}
                      </p>

                      <p>
                        <strong>User:</strong>{" "}
                        {selectedProcess.username ??
                          "Restricted"}
                      </p>

                      <p>
                        <strong>Memory:</strong>{" "}
                        {selectedProcess.memory_mb === null
                          ? "N/A"
                          : `${selectedProcess.memory_mb} MB`}
                      </p>

                      <p>
                        <strong>Started:</strong>{" "}
                        {selectedProcess.create_time
                          ? new Date(
                              selectedProcess.create_time * 1000
                            ).toLocaleString()
                          : "Unavailable"}
                      </p>

                      <p className="guardian-detail-wide">
                        <strong>Executable:</strong>{" "}
                        {selectedProcess.executable ??
                          "Restricted"}
                      </p>

                      <p className="guardian-detail-wide">
                        <strong>Command:</strong>{" "}
                        {selectedProcess.command_line?.join(" ") ??
                          "Restricted"}
                      </p> 
                        {selectedProcessAnalysis && (
                        <div className="guardian-detail-wide guardian-analysis-details">
                          <h4>Process Information</h4>
                         
                          <p>
                            <strong>Executable Location:</strong>{" "}
                            {selectedProcessAnalysis.executable ??
                              selectedProcess.executable ??
                              "Unavailable"}
                          </p>

                          <p>
                            <strong>Parent Process:</strong>{" "}
                            {selectedProcessAnalysis.parent_name ??
                              "Name unavailable"}
                            {selectedProcessAnalysis.parent_pid !== null
                              ? ` (PID: ${selectedProcessAnalysis.parent_pid})`
                              : ""}
                          </p>

                          <p>
                            <strong>Location Assessment:</strong>{" "}
                            {selectedProcessAnalysis.unusual_location
                              ? "Temporary directory — review recommended"
                              : selectedProcessAnalysis.executable
                              ? "No temporary-directory indicator detected"
                              : "Not assessed"}
                          </p>

                            <h4>What does this process do?</h4>
                            <p>{selectedProcessAnalysis.description}</p>
                            
                            <div className="guardian-risk-details">
                              <div className="guardian-risk-header">
                                <h4>CyberGuard Risk Assessment</h4>

                                <span
                                  className={`guardian-risk-badge ${
                                    selectedProcessAnalysis.risk_level_v2
                                  }`}
                                >
                                  {selectedProcessAnalysis.risk_score}/100
                                  {" · "}
                                  {selectedProcessAnalysis.risk_level_v2}
                                </span>
                              </div>

                              <div className="guardian-risk-track">
                                <div
                                  className={`guardian-risk-fill ${
                                    selectedProcessAnalysis.risk_level_v2
                                  }`}
                                  style={{
                                    width: `${selectedProcessAnalysis.risk_score}%`,
                                  }}
                                />
                              </div>

                              {selectedProcessAnalysis.risk_factors.length > 0 ? (
                                <div className="guardian-risk-factors">
                                  <h4>Why this score?</h4>

                                  {selectedProcessAnalysis.risk_factors.map(
                                    (factor, index) => (
                                      <div
                                        className="guardian-risk-factor"
                                        key={index}
                                      >
                                        <span>{factor.reason}</span>
                                        <strong>+{factor.points}</strong>
                                      </div>
                                    )
                                  )}
                                </div>
                              ) : (
                                <p>
                                  No indicators were detected by the current
                                  scoring rules.
                                </p>
                              )}

                              <p className="guardian-risk-disclaimer">
                                This score indicates investigation priority,
                                not the probability of malware.
                              </p>
                            </div>

                            <h4>Security & Performance Assessment</h4>

                            {selectedProcessAnalysis.warnings.length > 0 ? (
                            <div className="guardian-analysis-warning-box">
                                {selectedProcessAnalysis.warnings.map((warning) => (
                                <p key={warning}>{warning}</p>
                                ))}
                            </div>
                            ) : (
                            <p>No high-resource conditions detected in the latest sample.</p>
                            )}

                            <h4>Recommendations</h4>

                            {selectedProcessAnalysis.recommendations.length > 0 ? (
                            <ul>
                                {selectedProcessAnalysis.recommendations.map(
                                (recommendation) => (
                                    <li key={recommendation}>{recommendation}</li>
                                )
                                )}
                            </ul>
                            ) : (
                            <p>No additional recommendations at this time.</p>
                            )}
                            
                            <div className="guardian-termination-section">
                              <h4>Process Management</h4>

                              <p>
                                Ending an application may cause unsaved work to be lost.
                                Protected system processes cannot be terminated.
                              </p>

                              <button
                                type="button"
                                className="guardian-terminate-button"
                                disabled={terminationLoading}
                                onClick={() => {
                                  checkProcessTermination({
                                    pid: selectedProcess.pid,
                                    name: selectedProcess.name,
                                    create_time: selectedProcess.create_time,
                                  } as SystemProcess);
                                }}
                              >
                                {terminationLoading
                                  ? "Checking..."
                                  : "End Process"}
                              </button>

                              {terminationCheck && (
                                <div className="guardian-termination-result">
                                  <p>
                                    <strong>
                                      {terminationCheck.eligible
                                        ? "Process Eligible"
                                        : "Process Not Eligible"}
                                    </strong>
                                  </p>

                                  <p>{terminationCheck.reason}</p>

                                  {terminationCheck.eligible && !terminationConfirm && (
                                    <button
                                      type="button"
                                      className="guardian-confirm-button"
                                      onClick={() => setTerminationConfirm(true)}
                                    >
                                      Continue
                                    </button>
                                  )}
                                </div>
                                )}

                              {terminationConfirm && terminationCheck?.eligible && (
                                <div className="guardian-termination-confirm">
                                  <strong>Are you sure?</strong>

                                  <p>
                                    <strong>Warning: Unsaved work may be lost.</strong>
                                  </p>

                                  <p>
                                    Make sure to save your work before continuing.
                                    Ending {selectedProcess.name} (PID {selectedProcess.pid})
                                    may immediately close the application without saving
                                    any changes.
                                  </p>

                                  <div className="guardian-termination-actions">
                                    <button
                                      type="button"
                                      onClick={() => setTerminationConfirm(false)}
                                      disabled={terminationLoading}
                                    >
                                      Cancel
                                    </button>

                                    <button
                                      type="button"
                                      className="guardian-confirm-button"
                                      disabled={terminationLoading}
                                      onClick={confirmProcessTermination}
                                    >
                                      Confirm End Process
                                    </button>
                                  </div>
                                </div>
                              )}

                              {terminationMessage && (
                                <p className="guardian-termination-message" role="status">
                                  {terminationMessage}
                                </p>
                              )}
                            </div>
                        </div>
                        )}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default SystemGuardian;