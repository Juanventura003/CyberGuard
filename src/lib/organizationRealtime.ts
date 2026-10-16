import type { SupabaseClient } from "@supabase/supabase-js";

/** Each effect setup owns a channel, including StrictMode's setup/cleanup/setup cycle. */
export function subscribeOrganizationChanges(
  client: SupabaseClient,
  topic: string,
  table: "cg_incidents",
  onChange: () => void,
  options: {
    organizationId?: string;
    onStatus?: (connected: boolean) => void;
  } = {},
): () => void {
  let active = true;
  // Supabase reuses channels with the same topic while asynchronous removal is pending.
  const channel = client.channel(`${topic}-${crypto.randomUUID()}`);
  channel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table,
        ...(options.organizationId
          ? { filter: `organization_id=eq.${options.organizationId}` }
          : {}),
      },
      () => {
        if (active) onChange();
      },
    )
    .subscribe((status) => {
      if (!active) return;
      options.onStatus?.(status === "SUBSCRIBED");
      if (status === "SUBSCRIBED") onChange();
    });
  return () => {
    active = false;
    void client.removeChannel(channel).catch(() => undefined);
  };
}
