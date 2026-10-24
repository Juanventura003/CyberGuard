import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { organizationError } from "../lib/organizationData";
import OrganizationSettings from "./OrganizationSettings";
import ListPagination from "./ListPagination";

type RecordRow = {
  id?: string;
  domain?: string;
  title?: string;
  article_title?: string;
  details?: string;
  guidance?: string;
  admin_note?: string;
  reason?: string;
  status?: string;
  action?: string;
  email?: string;
  role?: string;
  user_id?: string;
};
const collections = {
  findings: {
    table: "cg_incidents",
    fields: "id,title,details,admin_note,status",
    order: "id",
    label: "Findings",
  },
  rules: {
    table: "cg_domain_rules",
    fields: "domain,reason,action",
    order: "domain",
    label: "Website rules",
  },
  notices: {
    table: "cg_team_notices",
    fields: "id,article_title,guidance",
    order: "id",
    label: "Team notices",
  },
  members: {
    table: "cg_memberships",
    fields: "user_id,email,role",
    order: "user_id",
    label: "Members",
  },
};
export default function ArchivedOrganization({
  organization,
  userId,
  isAdmin,
  onExit,
  onArchiveChanged,
}: {
  organization: {
    id: string;
    name: string;
    owner_id: string;
    archived_at?: string | null;
  };
  userId: string;
  isAdmin: boolean;
  onExit: (message: string) => void;
  onArchiveChanged: (message: string) => void;
}) {
  const [collection, setCollection] =
    useState<keyof typeof collections>("findings");
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    rows: RecordRow[];
    total: number;
  } | null>(null);
  const [error, setError] = useState("");
  const key = `${organization.id}:${collection}:${page}`;
  useEffect(() => {
    let active = true;
    const config = collections[collection];
    void (async () => {
      try {
        const { data, count, error } = await supabase!
          .from(config.table)
          .select(config.fields, { count: "exact" })
          .eq("organization_id", organization.id)
          .order(config.order)
          .range(page * 10, page * 10 + 9);
        if (error) throw error;
        if (active) {
          setResult({
            key,
            rows: data as unknown as RecordRow[],
            total: count ?? 0,
          });
          setError("");
        }
      } catch (cause) {
        if (active)
          setError(
            organizationError(cause, "Could not load archived records."),
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [organization.id, collection, page, key, retry]);
  return (
    <>
      <div className="org-notice">
        <strong>Archived organization · Read-only</strong>
        <p>
          Team protection has ended. Offline extensions remove cached team rules
          on their next successful sync. Personal blocks remain. Only the owner
          can restore or delete this team.
        </p>
      </div>
      <section className="org-card">
        <h2>Saved organization records</h2>
        <p className="org-help">
          Your existing record permissions still apply. Members can read their
          own findings and responses.
        </p>
        <label>
          Records
          <select
            value={collection}
            onChange={(event) => {
              setCollection(event.target.value as keyof typeof collections);
              setPage(0);
              setError("");
            }}
          >
            {Object.entries(collections)
              .filter(([name]) => isAdmin || name !== "members")
              .map(([name, config]) => (
                <option key={name} value={name}>
                  {config.label}
                </option>
              ))}
          </select>
        </label>
        {error && (
          <p className="org-error" role="alert">
            {error}{" "}
            <button onClick={() => setRetry((value) => value + 1)}>
              Retry
            </button>
          </p>
        )}
        {result?.key !== key ? (
          !error && <p role="status">Loading saved records…</p>
        ) : (
          <>
            {!result.rows.length && (
              <p className="org-help">No records available in this view.</p>
            )}
            {result.rows.map((row) => (
              <article
                className="org-card"
                key={row.id ?? row.domain ?? row.user_id}
              >
                <h3>
                  {row.title ?? row.article_title ?? row.domain ?? row.email}
                </h3>
                {(row.status || row.action || row.role) && (
                  <p className="org-help">
                    {row.status ?? row.action ?? row.role}
                  </p>
                )}
                <p className="org-evidence">
                  {row.details ?? row.guidance ?? row.reason}
                </p>
                {row.admin_note && (
                  <p className="org-evidence">
                    <strong>Admin response:</strong> {row.admin_note}
                  </p>
                )}
              </article>
            ))}
            <ListPagination
              page={page}
              total={result.total}
              pageSize={10}
              onPage={setPage}
              label="records"
            />
          </>
        )}
      </section>
      <OrganizationSettings
        key={organization.archived_at}
        organization={organization}
        userId={userId}
        onExit={onExit}
        onArchiveChanged={onArchiveChanged}
      />
    </>
  );
}
