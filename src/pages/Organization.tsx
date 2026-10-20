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
import HelpTip from "../components/HelpTip";
import OrganizationLiveActivity from "../components/OrganizationLiveActivity";
import OrganizationProtection from "../components/OrganizationProtection";
import OrganizationSettings from "../components/OrganizationSettings";
import OrganizationFindings from "../components/OrganizationFindings";
import OrganizationMembers, {
  type TeamMember,
  type TeamInvitation,
} from "../components/OrganizationMembers";
import "./Organization.css";

type Org = { id: string; name: string; owner_id: string };
type View = "protection" | "activity" | "reports" | "members" | "settings";
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
  const { forgetOrganization } = useOrganizationPresence("");
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
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [rosterError, setRosterError] = useState("");
  const [awaitingOrg, setAwaitingOrg] = useState("");
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState(false);
  const now = useOrganizationClock();
  const joinedOrgs = organizations.filter((org) =>
    memberships.some((member) => member.organization_id === org.id),
  );
  const requestedOrg = params.get("org");
  const org = requestedOrg
    ? joinedOrgs.find((item) => item.id === requestedOrg)
    : joinedOrgs[0];
  const section: View =
    params.get("view") === "review" || params.has("finding")
      ? "reports"
      : ["protection", "activity", "reports", "members", "settings"].includes(
            params.get("view") ?? "",
          )
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
              .select("id,name,owner_id", { count: "exact" })
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
      setReload((value) => value + 1);
    } catch (cause) {
      setActionError(organizationError(cause, "Could not save your change."));
    } finally {
      setBusy(false);
    }
  }
  function createOrg(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void perform(
      () =>
        supabase!.rpc("cg_create_organization", {
          org_name: new FormData(form).get("name"),
        }),
      "Organization created. You are its admin.",
      form,
      (id) => {
        if (typeof id === "string") {
          navigate("protection", id);
          setAwaitingOrg(id);
        }
      },
    );
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
      {incoming.length > 0 && (
        <section className="org-card">
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
                onClick={() =>
                  void perform(
                    () =>
                      supabase!.rpc("cg_accept_invitation", {
                        invite: invite.id,
                      }),
                    "Invitation accepted.",
                    undefined,
                    (id) => {
                      if (typeof id === "string") {
                        navigate("protection", id);
                        setAwaitingOrg(id);
                      }
                    },
                  )
                }
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
            <button
              disabled={busy}
              onClick={() => setReload((value) => value + 1)}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
          {requestedOrg && !org && !loadError && !awaitingOrg && (
            <div className="org-notice">
              This organization is unavailable to this account. Choose another
              team, accept its invitation, or sign in with an account that has
              joined it. No request has been sent.
            </div>
          )}
          <details
            className="org-card org-create"
            open={!joinedOrgs.length && !loadError}
          >
            <summary>
              <Building2 size={18} />
              Create an organization
              <HelpTip label="creating an organization">
                The creator becomes its owner and administrator. Invite members
                by their verified email address.
              </HelpTip>
            </summary>
            <form onSubmit={createOrg}>
              <label>
                Organization name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  disabled={busy}
                  placeholder="e.g. CyberGuard Project Team"
                />
              </label>
              <button className="org-primary" disabled={busy}>
                <Plus size={16} />
                Create organization
              </button>
            </form>
          </details>
          {org && (
            <>
              <nav className="org-tabs" aria-label="Team views">
                {(
                  [
                    "activity",
                    "protection",
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
                        : view === "reports"
                          ? isAdmin
                            ? "Security inbox"
                            : "My findings"
                          : view === "members"
                            ? "Members"
                            : "Settings"}
                  </button>
                ))}
              </nav>
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
                  onExit={(message) => {
                    forgetOrganization(org.id);
                    setOrganizations((items) =>
                      items.filter((item) => item.id !== org.id),
                    );
                    setInvites((items) =>
                      items.filter((item) => item.organization_id !== org.id),
                    );
                    setMemberships((items) =>
                      items.filter((item) => item.organization_id !== org.id),
                    );
                    setParams({});
                    setNotice(message);
                    setReload((value) => value + 1);
                  }}
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
                          supabase!.rpc("cg_revoke_invitation", { invite: id }),
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
