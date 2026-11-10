import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { subscribeOrganizationChanges } from "./organizationRealtime";

export type WarningOverride = {
  id: string;
  user_id: string;
  member_email: string;
  domain: string;
  reasons: string[];
  occurred_at: string;
  received_at: string;
  reviewed_at: string | null;
};
export function useWarningOverrides(organizationId: string | undefined, isAdmin: boolean, refreshRevision: number) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ org: string; onlyUnread: boolean; events: WarningOverride[]; unread: number; error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!organizationId || !isAdmin) return;
    return subscribeOrganizationChanges(supabase!, "warning-overrides", "cg_warning_overrides", refresh, { organizationId });
  }, [organizationId, isAdmin, refresh]);
  useEffect(() => {
    if (!organizationId || !isAdmin) return;
    let active = true;
    void (async () => {
      let query = supabase!.from("cg_warning_overrides")
        .select("id,user_id,member_email,domain,reasons,occurred_at,received_at,reviewed_at")
        .eq("organization_id", organizationId);
      if (onlyUnread) query = query.is("reviewed_at", null);
      const [events, count] = await Promise.all([
        query.order("received_at", { ascending: false }).order("id").limit(100),
        supabase!.from("cg_warning_overrides").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).is("reviewed_at", null),
      ]);
      if (!active) return;
      setState({ org: organizationId, onlyUnread, events: events.error ? [] : events.data ?? [], unread: count.count ?? 0,
        error: events.error || count.error ? "Could not load warning overrides. Check your connection and database setup, then refresh." : "" });
    })().catch(() => {
      if (active) setState({ org: organizationId, onlyUnread, events: [], unread: 0, error: "Could not load warning overrides. Please refresh." });
    });
    return () => { active = false; };
  }, [organizationId, isAdmin, refreshRevision, revision, onlyUnread]);
  async function review(ids: string[]) {
    if (busy || !organizationId || !isAdmin || !ids.length) return;
    setBusy(true);
    setActionError("");
    try {
      const { error } = await supabase!.rpc("cg_review_warning_overrides", { org: organizationId, event_ids: ids });
      if (error) throw error;
      refresh();
    } catch {
      setActionError("Could not mark overrides reviewed. Please try again.");
    } finally { setBusy(false); }
  }
  const current = state && state.org === organizationId && state.onlyUnread === onlyUnread ? state : null;
  return { events: current?.events ?? [], unread: current?.unread ?? 0, loading: isAdmin && !current,
    error: current?.error ?? "", actionError, busy, review, refresh, onlyUnread, setOnlyUnread };
}
