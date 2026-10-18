import { useEffect, useRef, useState, type ReactNode } from "react";
import { describePresenceDevice } from "../lib/presenceDevice";
import { supabase } from "../lib/supabase";
import {
  OrganizationPresenceContext as Context,
  type Preference,
} from "./organizationPresence";

export function OrganizationPresenceProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(Boolean(userId && supabase));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [presenceRevision, setPresenceRevision] = useState(0);
  const changing = useRef(false);
  const generation = useRef(0);
  const lastInteraction = useRef(0);
  useEffect(() => {
    if (!userId || !supabase) return;
    let active = true;
    const epoch = generation.current;
    void Promise.resolve(supabase.rpc("cg_get_device_presence_preferences"))
      .then(({ data, error }) => {
        if (!active || changing.current || generation.current !== epoch) return;
        if (error) {
          setPreferences([]);
          setError("Could not load your sharing preference. Please try again.");
        } else {
          setPreferences(data ?? []);
          setError("");
        }
        setLoading(false);
      })
      .catch(() => {
        if (active && generation.current === epoch) {
          setPreferences([]);
          setError(
            "Presence settings unavailable. Try again when your connection recovers.",
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [userId, reload]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setReload((value) => value + 1);
    }, 15000);
    const focus = () => setReload((value) => value + 1);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  const enabledOrgs = preferences
    .filter((pref) => pref.enabled)
    .map((pref) => pref.organization_id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!userId || !supabase || !enabledOrgs) return;
    const client = supabase;
    const orgs = enabledOrgs.split(",");
    const description = describePresenceDevice(navigator.userAgent);
    const session = crypto.randomUUID();
    let active = true;
    let queue: Promise<unknown> = Promise.resolve();
    let sending = false;
    let sendAgain = false;
    lastInteraction.current = Date.now();
    const heartbeat = () => {
      if (sending) {
        sendAgain = true;
        return;
      }
      sending = true;
      const isActive =
        !document.hidden &&
        document.hasFocus() &&
        Date.now() - lastInteraction.current < 120000;
      queue = queue
        .then(async () => {
          if (!active) return;
          const results = await Promise.all(
            orgs.map((org) =>
              client.rpc("cg_presence_device", {
                org,
                session,
                is_active: isActive,
                os: description.os,
                device: description.device,
              }),
            ),
          );
          if (active) {
            setError(
              results.some((result) => result.error)
                ? "Presence update unavailable."
                : "",
            );
            if (results.some((result) => !result.error))
              setPresenceRevision((value) => value + 1);
          }
        })
        .catch(() => {
          if (active) setError("Presence update unavailable.");
        })
        .finally(() => {
          sending = false;
          if (active && sendAgain) {
            sendAgain = false;
            heartbeat();
          }
        });
    };
    let lastSent = Date.now();
    const interact = () => {
      const wasIdle = Date.now() - lastInteraction.current >= 120000;
      lastInteraction.current = Date.now();
      if (wasIdle && Date.now() - lastSent > 1000) {
        lastSent = Date.now();
        heartbeat();
      }
    };
    for (const event of ["pointerdown", "keydown", "scroll", "touchstart"])
      document.addEventListener(event, interact, { passive: true });
    window.addEventListener("focus", heartbeat);
    window.addEventListener("blur", heartbeat);
    document.addEventListener("visibilitychange", heartbeat);
    heartbeat();
    const timer = window.setInterval(heartbeat, 20000);
    return () => {
      active = false;
      clearInterval(timer);
      for (const event of ["pointerdown", "keydown", "scroll", "touchstart"])
        document.removeEventListener(event, interact);
      window.removeEventListener("focus", heartbeat);
      window.removeEventListener("blur", heartbeat);
      document.removeEventListener("visibilitychange", heartbeat);
      void queue
        .then(() =>
          Promise.all(
            orgs.map((org) =>
              client.rpc("cg_presence", {
                org,
                session,
                enabled: false,
                is_active: false,
              }),
            ),
          ),
        )
        .catch(() => undefined);
    };
  }, [userId, enabledOrgs]);
  function forgetOrganization(org: string) {
    generation.current++;
    setPreferences((previous) =>
      previous.filter((pref) => pref.organization_id !== org),
    );
    setReload((value) => value + 1);
  }
  async function setSharing(org: string, enabled: boolean) {
    if (!supabase || !userId || changing.current) return;
    changing.current = true;
    const epoch = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("cg_set_device_presence_sharing", {
        org,
        sharing: enabled,
      });
      if (error) throw new Error(error.message);
      if (generation.current !== epoch) return;
      setPreferences((previous) => [
        ...previous.filter((pref) => pref.organization_id !== org),
        { organization_id: org, enabled },
      ]);
      // Off removes server rows in the consent RPC. On refreshes again after the first heartbeat.
      setPresenceRevision((value) => value + 1);
    } catch {
      setError(
        "Could not save presence sharing. Your preference was not changed.",
      );
    } finally {
      changing.current = false;
      setBusy(false);
      setLoading(false);
      setReload((value) => value + 1);
    }
  }
  return (
    <Context.Provider
      value={{
        forgetOrganization,
        presenceRevision,
        preferences,
        loading,
        busy,
        error,
        setSharing,
      }}
    >
      {children}
    </Context.Provider>
  );
}
