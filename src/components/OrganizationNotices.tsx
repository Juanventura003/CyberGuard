import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Newspaper, RefreshCw } from "lucide-react";
import PublishGeneralAnnouncement from "./PublishGeneralAnnouncement";
import { supabase } from "../lib/supabase";
import {
  listTeamNotices,
  noticeArticleLink,
  type NoticePage,
} from "../lib/teamNotices";
import { organizationError } from "../lib/organizationData";
import { useOrganizationClock } from "../lib/useOrganizationClock";
import ListPagination from "./ListPagination";
import "./TeamNotices.css";

export default function OrganizationNotices({
  organizationId,
  isAdmin,
}: {
  organizationId: string;
  isAdmin: boolean;
}) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: NoticePage;
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState("");
  const [publishingAnnouncement, setPublishingAnnouncement] = useState(false);
  const changing = useRef(false);
  const now = useOrganizationClock();
  const key = `${organizationId}:${isAdmin && includeInactive}:${page}`;
  useEffect(() => {
    let active = true;
    let fetching = false;
    async function load() {
      if (fetching) return;
      fetching = true;
      try {
        const data = await listTeamNotices(
          organizationId,
          isAdmin && includeInactive,
          page,
        );
        if (!active) return;
        if (page > 0 && page * 10 >= data.total) {
          setPage(Math.max(0, Math.ceil(data.total / 10) - 1));
          return;
        }
        setResult({ key, data });
        setLoadError("");
      } catch (cause) {
        if (active)
          setLoadError(
            organizationError(
              cause,
              "Could not load team notices. Please retry.",
            ),
          );
      } finally {
        fetching = false;
      }
    }
    void load();
    const visible = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(visible, 15000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [organizationId, isAdmin, includeInactive, page, key, reload]);

  async function act(
    id: string,
    operation: "acknowledge" | "pin" | "unpin" | "archive",
  ) {
    if (changing.current) return;
    changing.current = true;
    setPending(id);
    setActionError("");
    setMessage("");
    try {
      const { error } =
        operation === "acknowledge"
          ? await supabase!.rpc("cg_acknowledge_team_notice", { notice: id })
          : await supabase!.rpc("cg_manage_team_notice", {
              notice: id,
              operation,
            });
      if (error) throw error;
      setMessage(
        operation === "acknowledge"
          ? "Notice acknowledged."
          : operation === "archive"
            ? "Notice archived."
            : "Notice updated.",
      );
      setReload((value) => value + 1);
    } catch (cause) {
      setActionError(
        organizationError(cause, "Could not update this notice. Please retry."),
      );
    } finally {
      changing.current = false;
      setPending("");
    }
  }

  const data = result?.key === key ? result.data : null;
  const notices =
    data?.notices.filter(
      (notice) =>
        (isAdmin && includeInactive) ||
        (!notice.archived_at &&
          (!notice.expires_at || Date.parse(notice.expires_at) > now)),
    ) ?? [];
  const [announcements, setAnnouncements] = useState<{
    id: string;
    title: string;
    message: string;
    pinned: boolean;
    published_at: string;
    expires_at: string | null;
    archived_at: string | null;
    acknowledged_at: string | null;
    acknowledged_count: number;
    member_count: number;
  }[]>([]);
  useEffect(() => {
    let active = true;
    void supabase!
      .from("cg_general_announcements")
      .select("id,title,message,pinned,published_at,expires_at,archived_at")
      .eq("organization_id", organizationId)
      .order("published_at", { ascending: false })
      .limit(100)
      .then(async ({ data, error }) => {
        if (error || !active) return;
        const ids = (data ?? []).map((item) => item.id);
        const [
            { data: currentUser },
            { data: acknowledgements },
            { count: memberCount },
        ] = await Promise.all([
            supabase!.auth.getUser(),
            ids.length
              ? supabase!
                  .from("cg_general_announcement_acknowledgements")
                  .select("announcement_id,user_id,acknowledged_at")
                  .in("announcement_id", ids)
              : Promise.resolve({ data: [] }),
            supabase!
              .from("cg_memberships")
              .select("user_id", { count: "exact", head: true })
              .eq("organization_id", organizationId),
          ]);
        if (!active) return;
        const acknowledged = new Map(
          (acknowledgements ?? [])
            .filter((item) => item.user_id === currentUser.user?.id)
            .map((item) => [item.announcement_id, item.acknowledged_at]),
        );
        const acknowledgedCounts = new Map<string, number>();
        for (const acknowledgement of acknowledgements ?? []) {
          acknowledgedCounts.set(
            acknowledgement.announcement_id,
            (acknowledgedCounts.get(acknowledgement.announcement_id) ?? 0) + 1,
          );
        }
        setAnnouncements(
          (data ?? []).map((item) => ({
            ...item,
            acknowledged_at: acknowledged.get(item.id) ?? null,
            acknowledged_count: acknowledgedCounts.get(item.id) ?? 0,
            member_count: memberCount ?? 0,
          })),
        );
      });
    return () => {
      active = false;
    };
  }, [organizationId, reload, includeInactive]);
  const visibleAnnouncements = announcements.filter(
    (announcement) =>
      (isAdmin && includeInactive) ||
      (!announcement.archived_at &&
        (!announcement.expires_at || Date.parse(announcement.expires_at) > now)),
  );
  return (
    <section className="org-card" aria-label="Team notices">
      <div className="org-list-heading">
        <div>
          <h2>
            <Newspaper size={20} /> Team notices
          </h2>
          <p className="org-help">
            News selected by your admin, with guidance for your organization.
          </p>
        </div>
        <button
          onClick={() => setReload((value) => value + 1)}
          disabled={!!pending}
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      {isAdmin && (
        <div className="notice-actions">
          <Link to="/news">Choose a news article to share</Link>
          <button onClick={() => setPublishingAnnouncement(true)}>
            Write a general announcement
          </button>
          <label>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setPage(0);
              }}
            />{" "}
            Include archived and expired notices
          </label>
        </div>
      )}
      {loadError && (
        <p role="alert" className="org-error">
          {loadError}{" "}
          <button onClick={() => setReload((value) => value + 1)}>Retry</button>
        </p>
      )}
      {actionError && (
        <p role="alert" className="org-error">
          {actionError}
        </p>
      )}
      {message && (
        <p role="status" className="org-notice">
          {message}
        </p>
      )}
      {!data && !loadError && <p role="status">Loading team notices…</p>}
      {data && !notices.length && (
        <p className="org-help">
          {isAdmin
            ? "No notices in this view. Share a relevant article from News to add guidance for your team."
            : "No active team notices. Your admin’s selected news will appear here."}
        </p>
      )}
      <div className="notice-list">
        {visibleAnnouncements.map((announcement) => {
          const expired =
            !!announcement.expires_at && Date.parse(announcement.expires_at) <= now;
          const inactive = !!announcement.archived_at || expired;
          return (
            <article className={`notice-card${announcement.pinned ? " is-pinned" : ""}`} key={`announcement-${announcement.id}`}>
              <div className="notice-meta">
                <span className="notice-badge">General announcement</span>
                {announcement.pinned && <span className="notice-badge">Pinned</span>}
                {announcement.archived_at && <span>Archived</span>}
                {expired && <span>Expired</span>}
              </div>
              <h3>{announcement.title}</h3>
              <p className="notice-meta">Published to team {new Date(announcement.published_at).toLocaleString()}</p>
              <p className="notice-guidance">{announcement.message}</p>
              {announcement.expires_at && <p className="notice-help">{expired ? "Expired" : "Expires"} {new Date(announcement.expires_at).toLocaleString()}</p>}
              {isAdmin && (
                <p className="notice-count">
                  Acknowledged by {announcement.acknowledged_count} of{" "}
                  {announcement.member_count} current members
                </p>
              )}
              <div className="notice-actions">
                {announcement.acknowledged_at ? (
                  <span className="notice-help">You acknowledged this {new Date(announcement.acknowledged_at).toLocaleString()}</span>
                ) : !inactive ? (
                  <button disabled={!!pending} onClick={async () => {
                    setPending(announcement.id);
                    const { error } = await supabase!.from("cg_general_announcement_acknowledgements").insert({ announcement_id: announcement.id, user_id: (await supabase!.auth.getUser()).data.user?.id });
                    setPending("");
                    if (error) setActionError(organizationError(error, "Could not acknowledge this announcement."));
                    else setReload((value) => value + 1);
                  }}>Acknowledge announcement</button>
                ) : null}
                {isAdmin && !announcement.archived_at && (
                  <button
                    disabled={!!pending}
                    onClick={async () => {
                      setPending(announcement.id);
                      setActionError("");
                      const { error } = await supabase!
                        .from("cg_general_announcements")
                        .update({ archived_at: new Date().toISOString() })
                        .eq("id", announcement.id);
                      setPending("");
                      if (error)
                        setActionError(
                          organizationError(
                            error,
                            "Could not archive this announcement.",
                          ),
                        );
                      else {
                        setMessage("Announcement archived.");
                        setReload((value) => value + 1);
                      }
                    }}
                  >
                    Archive
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {notices.map((notice) => {
          const expired =
            !!notice.expires_at && Date.parse(notice.expires_at) <= now;
          const inactive = !!notice.archived_at || expired;
          const url = noticeArticleLink(notice.article_url);
          return (
            <article
              className={`notice-card${notice.pinned ? " is-pinned" : ""}`}
              key={notice.id}
            >
              <div className="notice-meta">
                <span className="notice-badge">Selected by your admin</span>
                {notice.pinned && <span className="notice-badge">Pinned</span>}
                {notice.archived_at && <span>Archived</span>}
                {expired && <span>Expired</span>}
              </div>
              <h3>{notice.article_title}</h3>
              <p className="notice-meta">
                {notice.article_source} · Published to team{" "}
                {new Date(notice.published_at).toLocaleString()}
              </p>
              <p className="notice-guidance">{notice.guidance}</p>
              {notice.expires_at && (
                <p className="notice-help">
                  {expired ? "Expired" : "Expires"}{" "}
                  {new Date(notice.expires_at).toLocaleString()}
                </p>
              )}
              {isAdmin && (
                <p className="notice-count">
                  Acknowledged by {notice.acknowledged_count ?? 0} of{" "}
                  {notice.member_count ?? 0} current members
                </p>
              )}
              <div className="notice-actions">
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    Read original article
                  </a>
                )}
                {notice.acknowledged_at ? (
                  <span className="notice-help">
                    You acknowledged this{" "}
                    {new Date(notice.acknowledged_at).toLocaleString()}
                  </span>
                ) : (
                  !inactive && (
                    <button
                      disabled={!!pending}
                      onClick={() => void act(notice.id, "acknowledge")}
                    >
                      {pending === notice.id ? "Saving…" : "Acknowledge notice"}
                    </button>
                  )
                )}
                {isAdmin && !inactive && (
                  <>
                    <button
                      disabled={!!pending}
                      onClick={() =>
                        void act(notice.id, notice.pinned ? "unpin" : "pin")
                      }
                    >
                      {notice.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      disabled={!!pending}
                      onClick={() => void act(notice.id, "archive")}
                    >
                      Archive
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {publishingAnnouncement && (
        <PublishGeneralAnnouncement
          organizations={[{ id: organizationId, name: "This organization" }]}
          onClose={() => setPublishingAnnouncement(false)}
          onPublished={() => {
            setPublishingAnnouncement(false);
            setReload((value) => value + 1);
          }}
        />
      )}
      {data && (
        <ListPagination
          page={page}
          total={data.total}
          pageSize={10}
          onPage={setPage}
          busy={!!pending}
          label="notices"
        />
      )}
    </section>
  );
}
