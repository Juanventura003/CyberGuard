import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, Plus, RefreshCw, Shield } from "lucide-react";
import { subscribeOrganizationChanges } from "../lib/organizationRealtime";
import {
  collectOrganizationPages,
  organizationError,
} from "../lib/organizationData";
import { useOrganizationClock } from "../lib/useOrganizationClock";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useOrganizationPresence } from "../context/organizationPresence";
import CreateOrganization from "../components/CreateOrganization";
import PresenceAgreement from "../components/PresenceAgreement";
import OrganizationLiveActivity from "../components/OrganizationLiveActivity";
import OrganizationProtection from "../components/OrganizationProtection";
import OrganizationSettings from "../components/OrganizationSettings";
import ArchivedOrganization from "../components/ArchivedOrganization";
import OrganizationFindings from "../components/OrganizationFindings";
import OrganizationNotices from "../components/OrganizationNotices";
import OrganizationMembers, {
  type TeamMember,
  type TeamInvitation,
} from "../components/OrganizationMembers";
import "./Organization.css";

type Org = {
  id: string;
  name: string;
  owner_id: string;
  archived_at: string | null;
};
type View =
  "protection" | "activity" | "reports" | "members" | "settings" | "notices";
export default function Organization() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="org-page" role="status">
        Loading account…
      </div>
    );
  if (!supabase)
    return (
      <div className="org-page">
        <h1>Team security</h1>
        <p>
          Team security is unavailable until the app’s Supabase connection is
          configured.
        </p>
      </div>
    );
  if (!user)
    return (
      <div className="org-page">
        <Shield size={36} />
        <h1>Security works better together.</h1>
        <p>
          Sign in using the sidebar to join your team, manage protection, or
          share a finding.
        </p>
      </div>
    );
  return <Workspace key={user.id} userId={user.id} email={user.email ?? ""} />;
}
function Workspace({ userId, email }: { userId: string; email: string }) {
  const {
    forgetOrganization,
    preferences,
    loading: presenceLoading,
    refreshPreferences,
    reviewRequirement,
    error: presenceError,
  } = useOrganizationPresence("");
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [joiningInvite, setJoiningInvite] = useState<TeamInvitation | null>(
    null,
  );
  const [params, setParams] = useSearchParams();
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [memberships, setMemberships] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvitation[]>([]);
  const [roster, setRoster] = useState<{ org: string; members: TeamMember[] }>({
    org: "",
    members: [],
  });
  const [reload, setReload] = useState(0);
  const [findingRevision, setFindingRevision] = useState(0);
  const [reviewCount, setReviewCount] = useState<{
    org: string;
    count: number | null;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [rosterError, setRosterError] = useState("");
  const [awaitingOrg, setAwaitingOrg] = useState("");
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState(false);
  const now = useOrganizationClock();
  const allJoinedOrgs = organizations.filter((org) =>
    memberships.some((member) => member.organization_id === org.id),
  );
  const requestedOrg = params.get("org");
  const showArchived =
    params.get("teams") === "archived" ||
    !!allJoinedOrgs.find((item) => item.id === requestedOrg)?.archived_at;
  const joinedOrgs = allJoinedOrgs.filter(
    (item) => !!item.archived_at === showArchived,
  );
  const org = requestedOrg
    ? allJoinedOrgs.find((item) => item.id === requestedOrg)
    : joinedOrgs[0];
  const section: View =
    params.get("view") === "review" || params.has("finding")
      ? "reports"
      : [
            "protection",
            "activity",
            "reports",
            "members",
            "settings",
            "notices",
          ].includes(params.get("view") ?? "")
        ? (params.get("view") as View)
        : "protection";
  const orgId = org?.id;
  const isAdmin = memberships.some(
    (member) => member.organization_id === org?.id && member.role === "admin",
  );
  const teamMembers =
    roster.org === org?.id
      ? roster.members
      : memberships.filter((member) => member.organization_id === org?.id);
  const incoming = invites.filter(
    (invite) =>
      !organizations.find((item) => item.id === invite.organization_id)
        ?.archived_at &&
      invite.email.toLowerCase() === email.toLowerCase() &&
      !memberships.some(
        (member) => member.organization_id === invite.organization_id,
      ) &&
      Date.parse(invite.expires_at) > now,
  );
  function navigate(
    view: View,
    orgId = org?.id,
    extra: Record<string, string> = {},
  ) {
    setAwaitingOrg("");
    setParams({ ...(orgId ? { org: orgId } : {}), view, ...extra });
  }
  useEffect(() => {
    let active = true;
    const client = supabase!;
    void (async () => {
      try {
        const [teams, ownMemberships, invitations] = await Promise.all([
          collectOrganizationPages<Org>((from, to) =>
            client
              .from("cg_organizations")
              .select("id,name,owner_id,archived_at", { count: "exact" })
              .order("id")
              .range(from, to),
          ),
          collectOrganizationPages<TeamMember>((from, to) =>
            client
              .from("cg_memberships")
              .select("organization_id,user_id,email,role", { count: "exact" })
              .eq("user_id", userId)
              .order("organization_id")
              .range(from, to),
          ),
          collectOrganizationPages<TeamInvitation>((from, to) =>
            client
              .from("cg_invitations")
              .select("id,organization_id,email,expires_at", { count: "exact" })
              .order("id")
              .range(from, to),
          ),
        ]);
        if (active) {
          setOrganizations(teams);
          setMemberships(ownMemberships);
          setInvites(invitations);
          setLoadError("");
          setAwaitingOrg("");
        }
      } catch (cause) {
        if (active)
          setLoadError(
            organizationError(cause, "Could not load your organizations."),
          );
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reload, userId]);
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    const id = orgId;
    void collectOrganizationPages<TeamMember>((from, to) =>
      supabase!
        .from("cg_memberships")
        .select("organization_id,user_id,email,role", { count: "exact" })
        .eq("organization_id", id)
        .order("user_id")
        .range(from, to),
    )
      .then((members) => {
        if (active) {
          setRoster({ org: id, members });
          setRosterError("");
        }
      })
      .catch((cause) => {
        if (active)
          setRosterError(
            organizationError(cause, "Could not load team members."),
          );
      });
    return () => {
      active = false;
    };
  }, [orgId, reload]);
  useEffect(() => {
    const unsubscribe = subscribeOrganizationChanges(
      supabase!,
      `cg-team-${userId}`,
      "cg_incidents",
      () => setFindingRevision((value) => value + 1),
      { organizationId: org?.id, onStatus: setLive },
    );
    const refresh = () => setReload((value) => value + 1);
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [userId, org?.id]);
  useEffect(() => {
    if (!orgId || !isAdmin) return;
    let active = true;
    const id = orgId;
    void (async () => {
      try {
        const { count, error } = await supabase!
          .from("cg_incidents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", id)
          .is("archived_at", null)
          .in("status", ["new", "under_review", "confirmed"]);
        if (error || count === null)
          throw error ?? new Error("Count unavailable.");
        if (active) setReviewCount({ org: id, count });
      } catch {
        if (active) setReviewCount({ org: id, count: null });
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, isAdmin, reload, findingRevision]);
  async function perform(
    task: () => PromiseLike<{
      error: { message: string } | null;
      data?: unknown;
    }>,
    message: string,
    form?: HTMLFormElement,
    after?: (data: unknown) => void,
  ) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await task();
      if (result.error) throw result.error;
      setNotice(message);
      form?.reset();
      after?.(result.data);
      refreshPreferences();
      setReload((value) => value + 1);
    } catch (cause) {
      setActionError(organizationError(cause, "Could not save your change."));
    } finally {
      setBusy(false);
    }
  }
  function organizationCreated(id: string) {
    setCreatingOrganization(false);
    setNotice("Organization created. You are its admin.");
    navigate("protection", id);
    setAwaitingOrg(id);
    refreshPreferences();
    setReload((value) => value + 1);
  }
  function exitOrganization(message: string) {
    if (!org) return;
    forgetOrganization(org.id);
    setOrganizations((items) => items.filter((item) => item.id !== org.id));
    setInvites((items) =>
      items.filter((item) => item.organization_id !== org.id),
    );
    setMemberships((items) =>
      items.filter((item) => item.organization_id !== org.id),
    );
    setParams({});
    setNotice(message);
    setReload((value) => value + 1);
  }
  function archiveChanged(message: string) {
    if (!org) return;
    setNotice(message);
    setParams({
      org: org.id,
      view: "settings",
      ...(!org.archived_at ? { teams: "archived" } : {}),
    });
    setReload((value) => value + 1);
  }
  function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void perform(
      () =>
        supabase!.rpc("cg_invite_member", {
          org: org!.id,
          invite_email: new FormData(form).get("email"),
        }),
      "Invitation saved. Ask this person to sign in with that verified email and open Team Security.",
      form,
    );
  }
  return (
    <div className="org-page">
      <header className="org-header">
        <div>
          <p className="org-eyebrow">CYBERGUARD / TEAM SECURITY</p>
          <h1>Team security</h1>
          <p>Protection. People. Threats.</p>
        </div>
        <span className={`org-connection ${live ? "live" : ""}`}>
          {live ? "Live finding updates" : "Refreshing every 15s"}
        </span>
      </header>
      {(loadError || actionError || rosterError) && (
        <div className="org-error" role="alert">
          {actionError || loadError || rosterError}
          <button
            onClick={() => {
              setActionError("");
              setReload((value) => value + 1);
            }}
          >
            {actionError ? "Dismiss" : "Retry"}
          </button>
        </div>
      )}
      {notice && (
        <div className="org-notice" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            Dismiss
          </button>
        </div>
      )}
      {creatingOrganization && (
        <CreateOrganization
          onClose={() => setCreatingOrganization(false)}
          onCreated={organizationCreated}
        />
      )}
      {joiningInvite && (
        <PresenceAgreement
          key={joiningInvite.id}
          joining
          organizationName={
            organizations.find(
              (item) => item.id === joiningInvite.organization_id,
            )?.name ?? "your organization"
          }
          busy={busy}
          error={actionError}
          onClose={() => {
            setJoiningInvite(null);
            setActionError("");
          }}
          onConfirm={() =>
            void perform(
              () =>
                supabase!.rpc("cg_accept_invitation_v2", {
                  invite: joiningInvite.id,
                  accept_presence: true,
                }),
              "Invitation accepted.",
              undefined,
              (id) => {
                setJoiningInvite(null);
                if (typeof id === "string") {
                  navigate("protection", id);
                  setAwaitingOrg(id);
                }
              },
            )
          }
        />
      )}
      {incoming.length > 0 && (
        <section className="org-card org-invitations">
          <h2>Invitations for you</h2>
          {incoming.map((invite) => (
            <div className="org-row" key={invite.id}>
              <span>
                <strong>
                  {organizations.find(
                    (item) => item.id === invite.organization_id,
                  )?.name ?? "Organization"}
                </strong>
                <small>
                  Invited as member · expires{" "}
                  {new Date(invite.expires_at).toLocaleDateString()}
                </small>
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  setActionError("");
                  setJoiningInvite(invite);
                }}
              >
                Join organization
              </button>
            </div>
          ))}
        </section>
      )}
      {!loaded ? (
        <p role="status">Loading your teams…</p>
      ) : (
        <>
          <div className="org-toolbar">
            <label>
              Teams
              <select
                value={showArchived ? "archived" : "active"}
                onChange={(event) =>
                  setParams(
                    event.target.value === "archived"
                      ? { teams: "archived" }
                      : {},
                  )
                }
              >
                <option value="active">Active organizations</option>
                <option value="archived">Archived organizations</option>
              </select>
            </label>
            <label>
              Organization
              <select
                value={org?.id ?? ""}
                onChange={(event) => navigate("protection", event.target.value)}
              >
                {!org && (
                  <option value="">
                    {joinedOrgs.length
                      ? "Choose an organization"
                      : "No organization yet"}
                  </option>
                )}
                {joinedOrgs.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {org && (
              <span className="org-role">
                {org.owner_id === userId
                  ? "Owner · Admin"
                  : isAdmin
                    ? "Administrator"
                    : "Member"}
              </span>
            )}
            <div className="org-toolbar-actions">
              <button
                disabled={busy}
                onClick={() => setReload((value) => value + 1)}
              >
                <RefreshCw size={15} />
                Refresh
              </button>
              <button
                className="org-primary"
                disabled={busy}
                onClick={() => setCreatingOrganization(true)}
              >
                <Plus size={16} />
                Create organization
              </button>
            </div>
          </div>
          {requestedOrg && !org && !loadError && !awaitingOrg && (
            <div className="org-notice">
              This organization is unavailable to this account. Choose another
              team, accept its invitation, or sign in with an account that has
              joined it. No request has been sent.
            </div>
          )}
          {!allJoinedOrgs.length && !loadError && (
            <section className="org-card org-team-empty">
              <Building2 size={26} aria-hidden="true" />
              <h2>Create your first organization</h2>
              <p className="org-help">
                Bring your team together to manage website protection and share
                security guidance.
              </p>
              <button
                className="org-primary"
                disabled={busy}
                onClick={() => setCreatingOrganization(true)}
              >
                <Plus size={16} />
                Create organization
              </button>
            </section>
          )}
          {org?.archived_at && (
            <ArchivedOrganization
              key={org.id}
              organization={org}
              userId={userId}
              isAdmin={isAdmin}
              onExit={exitOrganization}
              onArchiveChanged={archiveChanged}
            />
          )}
          {org &&
            !org.archived_at &&
            !presenceLoading &&
            !preferences.some(
              (pref) => pref.organization_id === org.id && pref.accepted,
            ) && (
              <section className="org-card">
                <h2>Accept the membership requirement to continue</h2>
                <p>
                  Review the presence agreement to continue as a member. You can
                  also leave from Settings below.
                </p>
                {presenceError && <p role="alert">{presenceError}</p>}
                <button onClick={() => reviewRequirement(org.id)}>
                  Review presence agreement
                </button>{" "}
                <button onClick={refreshPreferences}>Refresh membership</button>
                <OrganizationSettings
                  organization={org}
                  userId={userId}
                  onExit={exitOrganization}
                  onArchiveChanged={archiveChanged}
                />
              </section>
            )}
          {org && !org.archived_at && presenceLoading && (
            <p role="status">Loading membership requirement…</p>
          )}
          {org &&
            !org.archived_at &&
            preferences.some(
              (pref) => pref.organization_id === org.id && pref.accepted,
            ) && (
              <>
                <nav className="org-tabs" aria-label="Team views">
                  {(
                    [
                      "activity",
                      "protection",
                      "notices",
                      "reports",
                      ...(isAdmin ? ["members"] : []),
                      "settings",
                    ] as View[]
                  ).map((view) => (
                    <button
                      key={view}
                      aria-pressed={section === view}
                      onClick={() => navigate(view)}
                    >
                      {view === "activity"
                        ? "Live activity"
                        : view === "protection"
                          ? "Protection"
                          : view === "notices"
                            ? "Team notices"
                            : view === "reports"
                              ? isAdmin
                                ? "Security inbox"
                                : "My findings"
                              : view === "members"
                                ? "Members"
                                : "Settings"}
                      {view === "reports" && isAdmin && (
                        <span
                          className="org-review-badge"
                          title="New, under review, and confirmed findings awaiting resolution; this is not an unread count."
                        >
                          {reviewCount?.org !== org.id
                            ? "Needs review: …"
                            : reviewCount.count === null
                              ? "Needs review: unavailable"
                              : `Needs review: ${reviewCount.count}`}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>
                {section === "notices" && (
                  <OrganizationNotices
                    key={org.id}
                    organizationId={org.id}
                    isAdmin={isAdmin}
                  />
                )}
                {section === "activity" && (
                  <OrganizationLiveActivity
                    key={org.id}
                    organizationId={org.id}
                    members={teamMembers}
                    userId={userId}
                    isAdmin={isAdmin}
                    visible
                    refreshRevision={reload}
                  />
                )}
                {section === "protection" && (
                  <OrganizationProtection
                    key={org.id}
                    organizationId={org.id}
                    organizationName={org.name}
                    isAdmin={isAdmin}
                    userId={userId}
                    members={teamMembers}
                    refreshRevision={reload}
                    onRequestReview={(domain) =>
                      navigate("reports", org.id, { view: "review", domain })
                    }
                  />
                )}
                {section === "settings" && (
                  <OrganizationSettings
                    key={org.id}
                    organization={org}
                    userId={userId}
                    onExit={exitOrganization}
                    onArchiveChanged={archiveChanged}
                  />
                )}
                {section === "members" &&
                  (isAdmin ? (
                    <OrganizationMembers
                      members={teamMembers}
                      invitations={invites.filter(
                        (item) => item.organization_id === org.id,
                      )}
                      ownerId={org.owner_id}
                      busy={busy}
                      now={now}
                      onInvite={inviteMember}
                      onRemove={(member) => {
                        if (
                          window.confirm(
                            `Remove ${member.email} from ${org.name}? Their extension connections will be revoked.`,
                          )
                        )
                          void perform(
                            () =>
                              supabase!.rpc("cg_remove_member", {
                                org: org.id,
                                member_id: member.user_id,
                              }),
                            "Member access removed.",
                          );
                      }}
                      onRevoke={(id) =>
                        void perform(
                          () =>
                            supabase!.rpc("cg_revoke_invitation", {
                              invite: id,
                            }),
                          "Invitation revoked.",
                        )
                      }
                    />
                  ) : (
                    <p>Administrator access is required to manage members.</p>
                  ))}
                {section === "reports" && (
                  <OrganizationFindings
                    key={`${org.id}:${params.get("finding") ?? ""}`}
                    organization={org}
                    members={teamMembers}
                    userId={userId}
                    email={email}
                    isAdmin={isAdmin}
                    initialFinding={params.get("finding") ?? undefined}
                    reviewDomain={
                      params.get("view") === "review"
                        ? (params.get("domain") ?? undefined)
                        : undefined
                    }
                    refreshRevision={`${reload}:${findingRevision}`}
                    onCancelReview={() => navigate("reports")}
                    onRefresh={(message) => {
                      setNotice(message);
                      setFindingRevision((value) => value + 1);
                    }}
                  />
                )}
              </>
            )}
        </>
      )}
    </div>
  );
}
