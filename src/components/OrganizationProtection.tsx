import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Monitor,
  RefreshCw,
  Shield,
  CheckCircle2,
  Globe,
  Users,
} from "lucide-react";
import HelpTip from "./HelpTip";
import { supabase } from "../lib/supabase";
import "./OrganizationProtection.css";
import {
  requestExtension as extensionRequest,
  type ExtensionState as LocalState,
} from "../lib/extensionBridge";
import {
  collectOrganizationPages,
  organizationError,
} from "../lib/organizationData";
import { useOrganizationClock } from "../lib/useOrganizationClock";
import ListPagination from "./ListPagination";

type Browser = {
  id: string;
  user_id: string;
  name: string;
  extension_version: string;
  applied_revision: number;
  last_seen_at: string | null;
  revoked_at: string | null;
  browser_family: string;
  os_family: string;
};
type Rule = { domain: string; reason: string };

export default function OrganizationProtection({
  organizationId,
  organizationName,
  isAdmin,
  userId,
  members,
  onRequestReview,
  refreshRevision,
}: {
  organizationId: string;
  organizationName: string;
  isAdmin: boolean;
  userId: string;
  members: { user_id: string; email: string }[];
  onRequestReview: (domain: string) => void;
  refreshRevision: number;
}) {
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [revision, setRevision] = useState(0);
  const [local, setLocal] = useState<LocalState | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [extensionAvailable, setExtensionAvailable] = useState<boolean | null>(
    null,
  );
  const [connectionSearch, setConnectionSearch] = useState("");
  const [connectionPage, setConnectionPage] = useState(0);
  const [ruleSearch, setRuleSearch] = useState("");
  const [rulePage, setRulePage] = useState(0);
  const now = useOrganizationClock();
  const [extensionError, setExtensionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [reload, setReload] = useState(0);
  const extensionGeneration = useRef(0);
  // Detect the current profile without changing its enrollment or requiring a click.
  useEffect(() => {
    let active = true;
    const generation = extensionGeneration.current;
    const controller = new AbortController();
    void extensionRequest("status", {}, controller.signal)
      .then((state) => {
        if (active && generation === extensionGeneration.current) {
          setLocal(state);
          setExtensionAvailable(true);
        }
      })
      .catch(() => {
        if (active && generation === extensionGeneration.current)
          setExtensionAvailable(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [organizationId, userId, reload, refreshRevision]);
  useEffect(() => {
    let active = true;
    const client = supabase!;
    void (async () => {
      try {
        const [devices, domains, versions] = await Promise.all([
          collectOrganizationPages<Browser>((from, to) =>
            client
              .from("cg_browser_enrollments")
              .select(
                "id,user_id,name,extension_version,applied_revision,last_seen_at,revoked_at,browser_family,os_family",
                { count: "exact" },
              )
              .eq("organization_id", organizationId)
              .order("id")
              .range(from, to),
          ),
          collectOrganizationPages<Rule>((from, to) =>
            client
              .from("cg_domain_rules")
              .select("domain,reason", { count: "exact" })
              .eq("organization_id", organizationId)
              .order("domain")
              .range(from, to),
          ),
          client
            .from("cg_organizations")
            .select("protection_revision")
            .eq("id", organizationId)
            .maybeSingle(),
        ]);
        if (versions.error) throw versions.error;
        if (!versions.data)
          throw new Error(
            "This organization is no longer available. Refresh your teams.",
          );
        if (active) {
          setBrowsers(devices);
          setRules(domains);
          setRevision(versions.data.protection_revision);
          setError("");
          setReady(true);
        }
      } catch (cause) {
        if (active) {
          setError(
            (cause as { message?: string }).message ??
              "Could not load protection data.",
          );
          setReady(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [organizationId, reload, refreshRevision]);
  async function extension(
    action: "status" | "enroll" | "sync" | "disconnect",
    name?: string,
  ) {
    extensionGeneration.current++;
    setBusy(true);
    setExtensionError("");
    setNotice("");
    try {
      const { data } = await supabase!.auth.getSession();
      if (!data.session)
        throw new Error("Sign in again before connecting your extension.");
      const state = await extensionRequest(action, {
        organizationId,
        organizationName,
        userId,
        ...(action === "enroll"
          ? { accessToken: data.session.access_token }
          : {}),
        ...(name ? { name } : {}),
      });
      setLocal(state);
      setExtensionAvailable(true);
      if (state.error) setExtensionError(state.error);
      setReload((value) => value + 1);
      if (!state.error)
        setNotice(
          action === "status"
            ? state.enrolled
              ? "Extension detected. Review its connection details below."
              : "Extension detected. Connect it below to receive your team's protection."
            : action === "disconnect"
            ? "Extension disconnected. Your personal website blocks are unchanged."
            : !state.enrolled
              ? "This extension is no longer connected to a team."
              : "Your extension has checked for the latest protection rules.",
        );
    } catch (cause) {
      if (action === "status") setExtensionAvailable(false);
      setExtensionError(
        cause instanceof Error ? cause.message : "Extension request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function mutate(
    task: () => PromiseLike<{ error: { message: string } | null }>,
    message: string,
    form?: HTMLFormElement,
  ) {
    setBusy(true);
    setNotice("");
    setActionError("");
    try {
      const result = await task();
      if (result.error) throw new Error(result.error.message);
      form?.reset();
      setNotice(message);
      setReload((value) => value + 1);
    } catch (cause) {
      setActionError(organizationError(cause, "Could not save change."));
    } finally {
      setBusy(false);
    }
  }
  function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void mutate(
      () =>
        supabase!.rpc("cg_set_domain_rule", {
          org: organizationId,
          host: values.get("domain"),
          explanation: values.get("reason"),
          blocked: true,
        }),
      "Website block published. Connected extensions usually apply it within a minute.",
      form,
    );
  }
  function status(browser: Browser) {
    if (browser.revoked_at) return "Disconnected";
    if (!browser.last_seen_at) return "Waiting for extension";
    if (now - Date.parse(browser.last_seen_at) > 180000)
      return "Not recently connected";
    if (browser.applied_revision !== revision) return "Update pending";
    return "Connected · up to date";
  }
  const visibleBrowsers = isAdmin
    ? browsers
    : browsers.filter((browser) => browser.user_id === userId);
  const belongsToAnotherAccount =
    local?.enrolled && local.userId !== undefined && local.userId !== userId;
  const localBrowser = browsers.find((browser) => browser.id === local?.id);
  const connectedHere =
    local?.enrolled &&
    local.organizationId === organizationId &&
    local.userId === userId &&
    !localBrowser?.revoked_at;
  const otherBrowsers = visibleBrowsers.filter(
    (browser) => browser.id !== local?.id && !browser.revoked_at,
  );
  const active = visibleBrowsers.filter((browser) => !browser.revoked_at);
  const current = active.filter(
    (browser) => status(browser) === "Connected · up to date",
  );
  const memberEmails = new Map(
    members.map((member) => [member.user_id, member.email]),
  );
  const connectedMemberIds = new Set(active.map((browser) => browser.user_id));
  const entries = [
    ...active.map((browser) => ({ key: browser.id, browser, member: null })),
    ...(isAdmin
      ? members
          .filter((member) => !connectedMemberIds.has(member.user_id))
          .map((member) => ({
            key: `member:${member.user_id}`,
            browser: null,
            member,
          }))
      : []),
  ].filter((entry) =>
    `${entry.browser?.name ?? ""} ${entry.browser?.browser_family ?? ""} ${entry.browser?.os_family ?? ""} ${memberEmails.get(entry.browser?.user_id ?? "") ?? entry.member?.email ?? ""}`
      .toLowerCase()
      .includes(connectionSearch.trim().toLowerCase()),
  );
  const currentConnectionPage = Math.min(
    connectionPage,
    Math.max(0, Math.ceil(entries.length / 10) - 1),
  );
  const filteredRules = rules.filter((rule) =>
    `${rule.domain} ${rule.reason}`
      .toLowerCase()
      .includes(ruleSearch.trim().toLowerCase()),
  );
  const currentRulePage = Math.min(
    rulePage,
    Math.max(0, Math.ceil(filteredRules.length / 10) - 1),
  );
  const history = visibleBrowsers.filter((browser) => browser.revoked_at);

  const renderBrowser = (browser: Browser) => (
    <div className="org-row" key={browser.id}>
      <span>
        <strong>{browser.name}</strong>
        <small>
          {memberEmails.get(browser.user_id) ??
            (browser.user_id === userId
              ? "Your browser"
              : "Team connection")}{" "}
          · {browser.browser_family} on {browser.os_family} · Extension{" "}
          {browser.extension_version}
        </small>
        <small>
          Last contact:{" "}
          {browser.last_seen_at
            ? new Date(browser.last_seen_at).toLocaleString()
            : "Never"}{" "}
          · Applied v{browser.applied_revision}
        </small>
        <span
          className={`org-protection-badge ${status(browser) === "Connected · up to date" ? "healthy" : status(browser) === "Update pending" ? "pending" : "neutral"}`}
        >
          {status(browser)}
        </span>
        {browser.revoked_at && (
          <small>
            Revoked · Shared blocks clear on next successful contact.
          </small>
        )}
      </span>
      {!browser.revoked_at && (
        <button
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                `Disconnect ${browser.name}? Shared blocks clear when it next connects.`,
              )
            )
              void mutate(
                () =>
                  supabase!.rpc("cg_revoke_browser", { browser: browser.id }),
                "Connection removed. Shared blocks clear when that extension next connects.",
              );
          }}
        >
          Disconnect
        </button>
      )}
    </div>
  );
  const browserControls = (
    <div className="org-browser-controls">
      <div className="org-heading-line">
        <h2>
          <Monitor size={21} /> {isAdmin ? "This browser" : "My protection"}
        </h2>
        <HelpTip label="connecting your extension">
          Use your existing Chrome profile. Install or reload CyberGuard in
          chrome://extensions, refresh this page, then check the connection.
          Admins can manage the team without connecting their own extension.
          Connecting activates shared website blocks in desktop Chrome or Edge.
          You can use CyberGuard and share app presence on mobile without
          connecting an extension.
        </HelpTip>
      </div>
      <div className="org-personal-status">
        <span
          className={`org-protection-badge ${ready && extensionAvailable && connectedHere && !local?.error && localBrowser && status(localBrowser) === "Connected · up to date" ? "healthy" : "neutral"}`}
        >
          {extensionAvailable === false
            ? "Extension not detected"
            : !ready && local?.enrolled
              ? "Status unavailable"
              : belongsToAnotherAccount
                ? "Connected with another account"
                : local?.enrolled && local.organizationId !== organizationId
                  ? "Connected to another team"
                  : local?.enrolled && localBrowser?.revoked_at
                    ? "Connection revoked"
                    : connectedHere
                      ? local?.error
                        ? "Update unavailable"
                        : localBrowser
                          ? status(localBrowser)
                          : "Connected · checking status"
                      : local
                        ? "Not connected"
                        : "Check your extension"}
        </span>
        <span>{organizationName} · This browser</span>
      </div>
      {(!local?.enrolled || extensionAvailable === false) && (
        <button disabled={busy} onClick={() => void extension("status")}>
          <Monitor size={16} /> {busy ? "Please wait…" : "Check my extension"}
        </button>
      )}
      {extensionAvailable === false && (
        <p className="org-help">
          Reload the CyberGuard extension, then refresh this tab to reconnect.
        </p>
      )}
      {(extensionError || local?.error) && (
        <p className="org-error" role="alert">
          {extensionError || local?.error}
        </p>
      )}
      {local &&
        (local.enrolled ? (
          <div className="org-enrollment">
            {belongsToAnotherAccount && (
              <p className="org-account-warning" role="status">
                This browser was connected using another CyberGuard account.
                Disconnect it below to connect as this account, or use a
                separate Chrome profile.
              </p>
            )}
            {!belongsToAnotherAccount &&
              local.organizationId !== organizationId && (
                <p>
                  This extension is connected to another organization.
                  Disconnect it before connecting to {organizationName}.
                </p>
              )}
            <p className="org-compact-meta">
              Updated:{" "}
              {local.lastSync
                ? new Date(local.lastSync).toLocaleString()
                : "Waiting for the first update"}
            </p>
            <button
              disabled={busy || extensionAvailable === false}
              onClick={() => void extension("sync")}
            >
              <RefreshCw size={15} />{" "}
              {connectedHere ? "Check for updates" : "Check again"}
            </button>
            <button
              disabled={busy || extensionAvailable === false}
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect your extension from this organization and remove its shared website blocks?",
                  )
                )
                  void extension("disconnect");
              }}
            >
              Disconnect this browser
            </button>
            <details>
              <summary>Connection details</summary>
              <p>
                {local.name} · {local.organizationName} · Rule version{" "}
                {local.revision}
              </p>
            </details>
          </div>
        ) : (
          <form
            className="org-enrollment"
            onSubmit={(event) => {
              event.preventDefault();
              const name =
                String(
                  new FormData(event.currentTarget).get("browser_name") ?? "",
                ).trim() || "CyberGuard extension";
              void extension("enroll", name);
            }}
          >
            <details>
              <summary>Optional name</summary>
              <label>
                Connection name
                <input
                  name="browser_name"
                  maxLength={80}
                  placeholder="e.g. My laptop"
                />
              </label>
            </details>
            <label className="org-connection-consent">
              <input type="checkbox" required disabled={busy} />{" "}
              <span>
                Allow {organizationName} to block websites and view my extension
                name, browser/OS, version, last contact, and update status.
              </span>
            </label>
            <button
              disabled={busy || !ready || extensionAvailable !== true}
              className="org-primary"
            >
              Connect to {organizationName}
            </button>
            <div className="org-inline-help">
              Stays connected after sign-out
              <HelpTip label="connection duration">
                Your extension keeps applying organization rules after you sign
                out. Disconnect here to stop, or ask your admin to revoke the
                connection. Only one organization can manage this extension at a
                time.
              </HelpTip>
            </div>
          </form>
        ))}
    </div>
  );
  return (
    <>
      {(error || actionError) && (
        <div role="alert" className="org-error">
          {actionError || error}{" "}
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
        <div role="status" className="org-notice">
          {notice}
        </div>
      )}
      <div
        className={`org-protection ${isAdmin ? "org-protection-admin" : "org-protection-member"}`}
      >
        {isAdmin && (
          <section className="org-card org-protection-intro">
            <div className="org-heading-line">
              <h2>
                <Shield size={21} />
                Team protection
              </h2>
              <HelpTip label="team protection">
                Manage your team’s website rules and extension connections here.
                Your own browser connection is optional. Extensions check for
                updates about once a minute; this view refreshes every 15
                seconds.
              </HelpTip>
            </div>
            <div className="org-stats">
              <div>
                <Monitor size={22} />
                <strong>{ready ? active.length : "—"}</strong>
                <span>Connections</span>
              </div>
              <div>
                <CheckCircle2 size={22} />
                <strong>{ready ? current.length : "—"}</strong>
                <span>Up to date</span>
              </div>
              <div>
                <Globe size={22} />
                <strong>{ready ? rules.length : "—"}</strong>
                <span>Blocked websites</span>
              </div>
            </div>
          </section>
        )}
        {isAdmin ? (
          <section className="org-card org-protection-connections">
            <div className="org-list-heading">
              <h2>
                <Users size={21} />
                Team connections
                <HelpTip label="team connections">
                  Connections belong to the account that connected the
                  extension. Up to date means it recently acknowledged the
                  current rules. Not recently connected does not mean the device
                  is off.
                </HelpTip>
              </h2>
              <button
                onClick={() => setReload((value) => value + 1)}
                disabled={busy}
              >
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
            {!ready && !error && <p role="status">Loading team connections…</p>}
            {members.length + active.length > 10 && (
              <label className="org-search-label">
                Find a connection
                <input
                  type="search"
                  value={connectionSearch}
                  onChange={(event) => {
                    setConnectionSearch(event.target.value);
                    setConnectionPage(0);
                  }}
                  placeholder="Name, email, browser, or OS"
                />
              </label>
            )}
            {ready &&
              entries
                .slice(
                  currentConnectionPage * 10,
                  (currentConnectionPage + 1) * 10,
                )
                .map((entry) =>
                  entry.browser ? (
                    renderBrowser(entry.browser)
                  ) : (
                    <div className="org-row" key={entry.key}>
                      <span>
                        <strong>{entry.member?.email}</strong>
                        <span className="org-protection-badge neutral">
                          Not connected
                        </span>
                      </span>
                    </div>
                  ),
                )}
            {ready && !entries.length && (
              <p className="org-help">
                {connectionSearch
                  ? "No matching connections."
                  : "No extension connections yet."}
              </p>
            )}
            <ListPagination
              label="team entries"
              page={currentConnectionPage}
              total={entries.length}
              pageSize={10}
              onPage={setConnectionPage}
            />
            {history.length > 0 && (
              <details className="org-other-connections">
                <summary>Revoked connections ({history.length})</summary>
                {history.slice(0, 25).map(renderBrowser)}
                {history.length > 25 && (
                  <p className="org-help">
                    Showing 25 revoked connections. Active connections are
                    listed above.
                  </p>
                )}
              </details>
            )}
          </section>
        ) : (
          <section className="org-card org-protection-connect">
            {browserControls}
            {ready && otherBrowsers.length > 0 && (
              <details className="org-other-connections">
                <summary>
                  Other browser connections ({otherBrowsers.length})
                </summary>
                {otherBrowsers.map(renderBrowser)}
              </details>
            )}
          </section>
        )}
        {isAdmin && (
          <details className="org-card org-admin-browser">
            <summary>
              <Monitor size={18} />
              <span>
                Protect my browser
                <small>
                  Optional · Apply the team’s rules to your own browser
                </small>
              </span>
            </summary>
            <div className="org-admin-browser-content">{browserControls}</div>
          </details>
        )}
        <section className="org-card org-protection-rules">
          <h2>
            <Globe size={21} /> Blocked websites
            <HelpTip label="website blocking">
              Blocks cover a domain and all subdomains for new visits.
              Already-open pages stay open. Personal blocks remain separate.
              Connected extensions usually apply changes within a minute.
              Removing a shared block does not remove a personal block.
            </HelpTip>
          </h2>
          {isAdmin && (
            <form onSubmit={createRule}>
              <label>
                Domain
                <input
                  name="domain"
                  required
                  maxLength={253}
                  placeholder="example.com"
                />
              </label>
              <label>
                Reason
                <input
                  name="reason"
                  required
                  maxLength={1000}
                  placeholder="Why should the team block it?"
                />
              </label>
              <button
                className="org-primary"
                disabled={busy || !ready || extensionAvailable !== true}
              >
                Block website
              </button>
            </form>
          )}
          {ready && !rules.length && (
            <div className="org-blocks-empty">
              <Shield size={26} />
              <strong>No shared blocks yet</strong>
              <span>
                {isAdmin
                  ? "Add a website above to protect your team."
                  : "Your admin’s shared blocks will appear here."}
              </span>
            </div>
          )}
          {rules.length > 10 && (
            <label className="org-search-label">
              Find a blocked website
              <input
                type="search"
                value={ruleSearch}
                onChange={(event) => {
                  setRuleSearch(event.target.value);
                  setRulePage(0);
                }}
                placeholder="Domain or reason"
              />
            </label>
          )}
          {ready && ruleSearch && !filteredRules.length && (
            <p className="org-help">No matching website rules.</p>
          )}
          {ready &&
            filteredRules
              .slice(currentRulePage * 10, (currentRulePage + 1) * 10)
              .map((rule) => (
                <div className="org-row" key={rule.domain}>
                  <span>
                    <strong>{rule.domain}</strong>
                    <small>{rule.reason}</small>
                  </span>
                  {isAdmin && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            supabase!.rpc("cg_set_domain_rule", {
                              org: organizationId,
                              host: rule.domain,
                              explanation: "",
                              blocked: false,
                            }),
                          "Rule revoked. Browsers restore access after syncing unless a personal block also applies.",
                        )
                      }
                    >
                      Remove block
                    </button>
                  )}
                  {!isAdmin && (
                    <button
                      disabled={busy}
                      onClick={() => onRequestReview(rule.domain)}
                    >
                      Request review
                    </button>
                  )}
                </div>
              ))}
          <ListPagination
            label="website rules"
            page={currentRulePage}
            total={filteredRules.length}
            pageSize={10}
            onPage={setRulePage}
          />
        </section>
      </div>
    </>
  );
}
