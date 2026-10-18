import { useEffect, useState } from "react";
import { Monitor, Smartphone, Users } from "lucide-react";
import { useOrganizationClock } from "../lib/useOrganizationClock";
import ListPagination from "./ListPagination";
import { useOrganizationPresence } from "../context/organizationPresence";
import HelpTip from "./HelpTip";
import { supabase } from "../lib/supabase";

type Presence = {
  user_id: string;
  active: boolean;
  seen_at: string;
  os_family: string;
  device_type: string;
};
export default function OrganizationLiveActivity({
  organizationId,
  members,
  userId,
  isAdmin,
  visible,
  refreshRevision,
}: {
  organizationId: string;
  members: { user_id: string; email: string }[];
  userId: string;
  isAdmin: boolean;
  visible: boolean;
  refreshRevision: number;
}) {
  const {
    presenceRevision,
    sharing,
    setSharing,
    busy: presenceBusy,
    loading: presenceLoading,
    error: presenceError,
  } = useOrganizationPresence(organizationId);
  const now = useOrganizationClock();
  const [pendingSharing, setPendingSharing] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [error, setError] = useState("");
  const filteredMembers = (
    isAdmin ? members : members.filter((item) => item.user_id === userId)
  ).filter((item) =>
    item.email.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filteredMembers.length / 25) - 1),
  );
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const people = await supabase!
          .from("cg_member_presence")
          .select("user_id,active,seen_at,os_family,device_type")
          .eq("organization_id", organizationId)
          .gte("seen_at", new Date(Date.now() - 75000).toISOString());
        if (people.error) throw people.error;
        if (active) {
          setPresence(people.data ?? []);
          setError("");
        }
      } catch {
        if (active) {
          setError(
            "Could not refresh member presence. Try again when your connection recovers.",
          );
          setPresence([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshRevision, organizationId, presenceRevision]);
  function memberStatus(id: string) {
    if (error) return "Status unavailable";
    const recent = presence.filter(
      (item) => item.user_id === id && now - Date.parse(item.seen_at) < 75000,
    );
    return recent.some((item) => item.active)
      ? "Active in CyberGuard"
      : recent.length
        ? "Away"
        : "No recent presence";
  }
  return (
    <section hidden={!visible} className="org-live-activity">
      <div className="org-card">
        <h2>
          <Users size={21} /> {isAdmin ? "Who’s active" : "Your presence"}
          <HelpTip label="member presence">
            Presence reflects activity across all CyberGuard pages, not whether
            a computer is online. Focus and recent interaction determine active
            or away; no keystrokes or click contents are recorded. Device type
            and OS are inferred from the browser and may be approximate or
            Unknown. Exact hardware models are not identified. Your choice is
            saved for this organization across tabs and sign-ins. Turning
            sharing off removes your current presence across sessions. Stale
            sessions expire after 75 seconds.
          </HelpTip>
        </h2>
        <label className="org-presence-consent">
          <input
            type="checkbox"
            checked={pendingSharing ?? sharing}
            disabled={presenceBusy || presenceLoading}
            onChange={(event) => {
              const desired = event.target.checked;
              setPendingSharing(desired);
              void setSharing(organizationId, desired).finally(() =>
                setPendingSharing(null),
              );
            }}
          />{" "}
          Share my active / away status and device type with admins while I use
          CyberGuard.
        </label>
        {presenceBusy && (
          <p className="org-help" role="status">
            Saving sharing preference…
          </p>
        )}
        {presenceError && <p role="alert">{presenceError}</p>}
        {error && (
          <p className="org-error" role="alert">
            {error}
          </p>
        )}
        {isAdmin && (
          <label className="org-search-label">
            Find a member
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search email"
            />
          </label>
        )}
        {filteredMembers
          .slice(currentPage * 25, (currentPage + 1) * 25)
          .map((member) => (
            <div className="org-row" key={member.user_id}>
              <span>
                <strong>{member.email}</strong>
                <span className="org-presence-devices">
                  {[
                    ...new Set(
                      presence
                        .filter(
                          (item) =>
                            item.user_id === member.user_id &&
                            now - Date.parse(item.seen_at) < 75000,
                        )
                        .map((item) =>
                          item.os_family === "Unknown" &&
                          item.device_type === "Unknown"
                            ? "Device type unavailable"
                            : `${item.os_family} ${item.device_type.toLowerCase()}`,
                        ),
                    ),
                  ].map((description) => (
                    <span className="org-device-chip" key={description}>
                      {/mobile|tablet/.test(description) ? (
                        <Smartphone size={14} />
                      ) : (
                        <Monitor size={14} />
                      )}
                      {description}
                    </span>
                  ))}
                </span>
              </span>
              <span
                className={`org-protection-badge ${memberStatus(member.user_id) === "Active in CyberGuard" ? "healthy" : "neutral"}`}
              >
                {memberStatus(member.user_id)}
              </span>
            </div>
          ))}
        <ListPagination
          label="members"
          page={currentPage}
          total={filteredMembers.length}
          pageSize={25}
          onPage={setPage}
        />
      </div>
    </section>
  );
}
