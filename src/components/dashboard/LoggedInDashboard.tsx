import {
  Globe,
  Mail,
  Search,
  TriangleAlert,
  Bot,
  Link,
} from "lucide-react";

function LoggedInDashboard() {
  const websites = [
    { name: "github.com", status: "Safe" },
    { name: "gmail.com", status: "Safe" },
    { name: "paypal-secure.net", status: "High Risk" },
  ];

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
});

  const emails = [
    {
      name: "security@paypal-accou...",
      status: "Likely Phishing",
    },
    {
      name: "hello@notion.so",
      status: "Safe",
    },
    {
      name: "offers@amazn-deals.net",
      status: "Suspicious",
    },
  ];

  const recentActivity = [
    {
      icon: <Globe size={18} />,
      name: "paypal-secure.net",
      description: "Website flagged as phishing",
      status: "High Risk",
      time: "1:58 PM",
    },
    {
      icon: <Mail size={18} />,
      name: "security@paypal-accounts.com",
      description: "Phishing email detected",
      status: "High Risk",
      time: "2:44 PM",
    },
    {
      icon: <Link size={18} />,
      name: "http://bit.ly/3xR2free",
      description: "Shortened URL with redirect",
      status: "Suspicious",
      time: "3:01 PM",
    },
    {
      icon: <Globe size={18} />,
      name: "free-gift-cards24.com",
      description: "Suspicious website detected",
      status: "Suspicious",
      time: "1:22 PM",
    },
    {
      icon: <Mail size={18} />,
      name: "offers@amazn-deals.net",
      description: "Suspicious email detected",
      status: "Suspicious",
      time: "10:15 AM",
    },
    {
      icon: <Globe size={18} />,
      name: "github.com",
      description: "Website checked",
      status: "Safe",
      time: "9:47 AM",
    },
  ];

  const getStatusClass = (status: string) => {
    if (status === "Safe") return "status safe";
    if (status === "Suspicious") return "status suspicious";
    return "status danger";
  };

  return (
    <div className="dashboard">
      {/* main header */}
      <div className="dashboard-header">
        <div>
          <p className="dashboard-date">{currentDate}</p>

          <h1>
            Good afternoon, Daniel
          </h1>

          <p className="dashboard-subtitle">
            Here's your security summary for today.
          </p>
        </div>

        <div className="monitoring-status">
          <span className="monitoring-dot"></span>
          Monitoring active
        </div>
      </div>

      {/* 4 summary cards */}
      <div className="summary-grid">
        <div className="summary-card">
          <div className="summary-icon blue">
            <Globe size={21} />
          </div>

          <div>
            <h2>8</h2>
            <h3>Websites Monitored</h3>
            <p>Today</p>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon purple">
            <Mail size={21} />
          </div>

          <div>
            <h2>4</h2>
            <h3>Emails Scanned</h3>
            <p>Today</p>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon cyan">
            <Search size={21} />
          </div>

          <div>
            <h2>4</h2>
            <h3>Security Checks</h3>
            <p>Today</p>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon red">
            <TriangleAlert size={21} />
          </div>

          <div>
            <h2>6</h2>
            <h3>Potential Risks</h3>
            <p>Detected today</p>
          </div>
        </div>
      </div>

      {/* Todays activity header*/}
      <h2 className="section-title">Today's Activity</h2>

      <div className="activity-grid">
        {/* Website tracker tab */}
        <div className="dashboard-panel">
          <div className="panel-header">
            <div className="panel-title">
              <div className="panel-icon">
                <Globe size={19} />
              </div>

              <div>
                <h3>Website Tracker</h3>
                <p>8 sites monitored</p>
              </div>
            </div>

            <span className="active-badge">Active</span>
          </div>

          <div className="panel-list">
            {websites.map((website) => (
              <div className="panel-row" key={website.name}>
                <span>{website.name}</span>

                <span className={getStatusClass(website.status)}>
                  <span className="status-dot">●</span>
                  {website.status}
                </span>
              </div>
            ))}
          </div>

          <button className="dashboard-button">
            View All Websites →
          </button>
        </div>

        {/* email scanner tab */}
        <div className="dashboard-panel">
          <div className="panel-header">
            <div className="panel-title">
              <div className="panel-icon purple">
                <Mail size={19} />
              </div>

              <div>
                <h3>Email Scanner</h3>
                <p>4 emails scanned</p>
              </div>
            </div>

            <span className="threat-badge">1 Threat</span>
          </div>

          <div className="panel-list">
            {emails.map((email) => (
              <div className="panel-row" key={email.name}>
                <span>{email.name}</span>

                <span className={getStatusClass(email.status)}>
                  <span className="status-dot">●</span>
                  {email.status}
                </span>
              </div>
            ))}
          </div>

          <button className="dashboard-button">
            Scan Emails →
          </button>
        </div>

        {/* security checker tab */}
        <div className="dashboard-panel">
          <div className="panel-header">
            <div className="panel-title">
              <div className="panel-icon">
                <Search size={19} />
              </div>

              <div>
                <h3>Security Checker</h3>
                <p>4 checks performed</p>
              </div>
            </div>
          </div>

          <div className="security-tools">
            <div>● Link Checker</div>
            <div>● File Checker</div>
            <div>● Password Checker</div>
            <div>● Domain Checker</div>
          </div>

          <button className="dashboard-button">
            Open Tools →
          </button>
        </div>

        {/* cyber ai assistant tab */}
        <div className="dashboard-panel">
          <div className="panel-header">
            <div className="panel-title">
              <div className="panel-icon green">
                <Bot size={19} />
              </div>

              <div>
                <h3>Cyber Assistant</h3>
                <p>Ask me anything</p>
              </div>
            </div>
          </div>

          <div className="assistant-question">
            "How can I tell if an email is a phishing attempt?"
          </div>

          <button className="dashboard-button">
            Ask a Question →
          </button>
        </div>
      </div>

      {/* recent activity header */}
      <h2 className="section-title recent-title">Recent Activity</h2>

      <div className="recent-activity">
        {recentActivity.map((activity, index) => (
          <div className="recent-row" key={index}>
            <div className="recent-info">
              <div className="recent-icon">{activity.icon}</div>

              <div>
                <h4>{activity.name}</h4>
                <p>{activity.description}</p>
              </div>
            </div>

            <div className="recent-right">
              <span className={getStatusClass(activity.status)}>
                <span className="status-dot">●</span>
                {activity.status}
              </span>

              <span className="activity-time">{activity.time}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LoggedInDashboard;