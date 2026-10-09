import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ExternalLink,
  Newspaper,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  fetchNews,
  fetchNewsActivity,
  updateNewsActivity,
  type NewsArticle,
  type NewsCategory,
  type NewsResponse,
} from "../api/newsApi";
import { useAuth } from "../context/AuthContext";

import "./News.css";

type Preferences = {
  saved: NewsArticle[];
  read: string[];
};

const categories: NewsCategory[] = [
  "Phishing",
  "Malware",
  "Breaches",
  "Vulnerabilities",
  "General",
];

const dateLabel = (date: string) =>
  new Date(date).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

function News() {
  const { user } = useAuth();

  return <NewsContent key={user?.id ?? "guest"} userId={user?.id} />;
}

function NewsContent({ userId }: { userId?: string }) {
  const [feed, setFeed] = useState<NewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [view, setView] = useState("Recent");
  const [now, setNow] = useState(() => Date.now());
  const [preferences, setPreferences] = useState<Preferences>({
    saved: [],
    read: [],
  });
  const [activityError, setActivityError] = useState("");
  const [activityLoading, setActivityLoading] = useState(Boolean(userId));
  const [activityReady, setActivityReady] = useState(!userId);
  const [pending, setPending] = useState<string[]>([]);
  const mounted = useRef(true);
  const pendingIds = useRef(new Set<string>());
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await fetchNews(controller.signal);
      if (!controller.signal.aborted) setFeed(result);
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Could not refresh news. Check that the backend is running and try again.",
        );
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setNow(Date.now());
      }
      if (request.current === controller) request.current = null;
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 300_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    let ignore = false;

    if (userId) {
      void fetchNewsActivity(userId)
        .then((activity) => {
          if (ignore) return;
          setPreferences({
            saved: activity
              .filter((entry) => entry.saved)
              .map((entry) => entry.article),
            read: activity
              .filter((entry) => entry.read)
              .map((entry) => entry.article.id),
          });
          setActivityReady(true);
        })
        .catch(() => {
          if (!ignore)
            setActivityError(
              "Could not load your saved articles and read status. Refresh the page to retry.",
            );
        })
        .finally(() => {
          if (!ignore) setActivityLoading(false);
        });
    }

    return () => {
      ignore = true;
      mounted.current = false;
    };
  }, [userId]);

  const saveActivity = async (
    article: NewsArticle,
    change: { saved?: boolean; read?: boolean },
  ) => {
    if (
      !userId ||
      !activityReady ||
      activityLoading ||
      pendingIds.current.has(article.id)
    )
      return;

    pendingIds.current.add(article.id);
    setPending((current) => [...current, article.id]);
    setActivityError("");

    const saved =
      change.saved ??
      preferences.saved.some((entry) => entry.id === article.id);
    const read = change.read ?? preferences.read.includes(article.id);

    try {
      await updateNewsActivity(userId, article, { saved, read });
      if (!mounted.current) return;

      setPreferences((current) => ({
        saved: saved
          ? [
              article,
              ...current.saved.filter((entry) => entry.id !== article.id),
            ]
          : current.saved.filter((entry) => entry.id !== article.id),
        read: read
          ? [...new Set([...current.read, article.id])]
          : current.read.filter((id) => id !== article.id),
      }));
    } catch {
      if (mounted.current)
        setActivityError(
          "Could not save your news activity. Please try again.",
        );
    } finally {
      pendingIds.current.delete(article.id);
      if (mounted.current)
        setPending((current) => current.filter((id) => id !== article.id));
    }
  };

  const query = search.trim().toLowerCase();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const articles = (
    view === "Saved" ? preferences.saved : (feed?.articles ?? [])
  )
    .filter(
      (article) =>
        (view === "Saved" ||
          (Date.parse(article.published_at) >= sevenDaysAgo &&
            Date.parse(article.published_at) <= now)) &&
        (category === "All" || article.category === category) &&
        (view !== "Unread" || !preferences.read.includes(article.id)) &&
        `${article.title} ${article.summary} ${article.source}`
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));

  return (
    <div className="news-page">
      <header className="news-header">
        <div>
          <div className="news-eyebrow">
            <Newspaper size={18} /> Stay informed
          </div>
          <h1>CyberTech News</h1>
          <p>
            Explore emerging threats and find tools to help protect yourself.
          </p>
        </div>
        <button
          className="news-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={17} className={loading ? "news-spinning" : ""} />{" "}
          {loading ? "Checking…" : "Refresh"}
        </button>
      </header>
      <p className="news-freshness">
        The server checks for updates every 5 minutes while the backend is running.
        {feed && <> Last fetched: {dateLabel(feed.fetched_at)}.</>}
      </p>
      {error && (
        <p role="alert" className="news-notice">
          {error}
          {feed && " Previously loaded articles remain available."}
        </p>
      )}
      {feed?.stale && (
        <p role="status" className="news-notice">
          The publisher is temporarily unavailable. Showing articles from the
          last successful fetch.
        </p>
      )}
      {activityError && (
        <p role="alert" className="news-notice">
          {activityError}
        </p>
      )}
      {!userId && (
        <p className="news-notice">
          Sign in to save articles and track your read status in your account.
        </p>
      )}
      {activityLoading && <p role="status">Loading your news activity…</p>}
      <section className="news-controls" aria-label="Filter news">
        <label className="news-search">
          <Search size={18} />
          <span className="news-sr-only">Search articles</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search threats, services, or keywords…"
          />
        </label>
        <label>
          Topic
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option>All</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Show
          <select
            value={view}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="Recent">Recent news</option>
            <option disabled={!userId}>Unread</option>
            <option disabled={!userId}>Saved</option>
          </select>
        </label>
      </section>
      <div className="news-results" aria-live="polite">
        {articles.length} articles ·{" "}
        {view === "Saved" ? "All dates" : "Past 7 days"} · Newest first
      </div>
      {loading && !feed && view !== "Saved" ? (
        <p role="status">Loading the latest cybersecurity news…</p>
      ) : articles.length === 0 ? (
        <div className="news-empty">
          <Newspaper size={32} />
          <h2>
            {view === "Saved"
              ? "No saved articles match"
              : "No articles to show"}
          </h2>
          <p>
            {view === "Saved"
              ? "Save an article from Recent news to revisit it here."
              : error
                ? "Use Refresh to try again."
                : "Try a different search, topic, or view."}
          </p>
        </div>
      ) : (
        <div className="news-grid">
          {articles.map((article) => {
            const saved = preferences.saved.some(
              (entry) => entry.id === article.id,
            );
            const read = preferences.read.includes(article.id);
            return (
              <article
                className={`news-card${read ? " news-read" : ""}`}
                key={article.id}
              >
                <div className="news-card-meta">
                  <span className="news-category">{article.category}</span>
                  {read && (
                    <span>
                      <Check size={14} /> Read
                    </span>
                  )}
                </div>
                <h2>{article.title}</h2>
                <p className="news-source">
                  {article.source} ·{" "}
                  <time dateTime={article.published_at}>
                    {dateLabel(article.published_at)}
                  </time>
                </p>
                <details>
                  <summary>Read summary</summary>
                  <p>
                    {article.summary ||
                      "No summary provided. Open the full article for details."}
                  </p>
                </details>
                <div className="news-card-actions">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (userId && !read)
                        void saveActivity(article, { read: true });
                    }}
                  >
                    Full article <ExternalLink size={14} />
                  </a>
                  <button
                    aria-pressed={saved}
                    disabled={
                      !userId ||
                      !activityReady ||
                      activityLoading ||
                      pending.includes(article.id)
                    }
                    onClick={() =>
                      void saveActivity(article, { saved: !saved })
                    }
                  >
                    <Bookmark size={15} />
                    {saved ? "Saved" : "Save"}
                  </button>
                  <button
                    aria-pressed={read}
                    disabled={
                      !userId ||
                      !activityReady ||
                      activityLoading ||
                      pending.includes(article.id)
                    }
                    onClick={() => void saveActivity(article, { read: !read })}
                  >
                    {read ? "Mark unread" : "Mark read"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="news-footnote">
        Recent news includes available feed articles from the past seven days; Saved articles remain
        available from any date.{" "}
      </p>
    </div>
  );
}

export default News;