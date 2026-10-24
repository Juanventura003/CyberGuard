import { useState, type FormEvent } from "react";
import HelpTip from "./HelpTip";
import ListPagination from "./ListPagination";
export type TeamMember = {
  organization_id: string;
  user_id: string;
  email: string;
  role: "admin" | "member";
};
export type TeamInvitation = {
  id: string;
  organization_id: string;
  email: string;
  expires_at: string;
};
export default function OrganizationMembers({
  members,
  invitations,
  ownerId,
  busy,
  now,
  onInvite,
  onRemove,
  onRevoke,
}: {
  members: TeamMember[];
  invitations: TeamInvitation[];
  ownerId: string;
  busy: boolean;
  now: number;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onRemove: (member: TeamMember) => void;
  onRevoke: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [invitePage, setInvitePage] = useState(0);
  const currentInvitePage = Math.min(
    invitePage,
    Math.max(0, Math.ceil(invitations.length / 25) - 1),
  );
  const filtered = members.filter((member) =>
    member.email.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 25) - 1),
  );
  return (
    <section className="org-card">
      <h2>
        Members
        <HelpTip label="invitations">
          Invitations appear in the recipient’s CyberGuard account. No email is
          sent. They expire after seven days and require the invited verified
          email to join.
        </HelpTip>
      </h2>
      <form onSubmit={onInvite}>
        <label>
          Member’s email
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            placeholder="teammate@example.com"
            disabled={busy}
          />
        </label>
        <button className="org-primary" disabled={busy}>
          Invite member
        </button>
      </form>
      <div className="org-list-heading org-members-heading">
        <h3>Team members · {members.length}</h3>
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
      </div>
      {!filtered.length && <p className="org-help">No matching members.</p>}
      {filtered
        .slice(currentPage * 25, (currentPage + 1) * 25)
        .map((member) => (
          <div className="org-row" key={member.user_id}>
            <span>
              <strong>{member.email}</strong>
              <small>
                {member.role}
                {member.user_id === ownerId ? " · owner" : ""}
              </small>
            </span>
            {member.user_id !== ownerId && (
              <button disabled={busy} onClick={() => onRemove(member)}>
                Remove access
              </button>
            )}
          </div>
        ))}
      <ListPagination
        label="members"
        page={currentPage}
        total={filtered.length}
        pageSize={25}
        onPage={setPage}
        busy={busy}
      />
      <details className="org-pending-invitations">
        <summary>Pending invitations ({invitations.length})</summary>
        {!invitations.length && (
          <p className="org-help">No pending invitations.</p>
        )}
        {invitations
          .slice(currentInvitePage * 25, (currentInvitePage + 1) * 25)
          .map((invite) => (
            <div className="org-row" key={invite.id}>
              <span>
                <strong>{invite.email}</strong>
                <small>
                  {Date.parse(invite.expires_at) < now
                    ? "Expired — invite again to renew"
                    : `Expires ${new Date(invite.expires_at).toLocaleDateString()}`}
                </small>
              </span>
              <button disabled={busy} onClick={() => onRevoke(invite.id)}>
                Revoke
              </button>
            </div>
          ))}
        <ListPagination
          label="invitations"
          page={currentInvitePage}
          total={invitations.length}
          pageSize={25}
          onPage={setInvitePage}
          busy={busy}
        />
      </details>
    </section>
  );
}
