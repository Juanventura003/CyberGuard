import { useEffect, useRef, useState, type ReactNode } from "react";
import PresenceAgreement from "../components/PresenceAgreement";
import { describePresenceDevice } from "../lib/presenceDevice";
import { supabase } from "../lib/supabase";
import {
  OrganizationPresenceContext as Context,
  type Preference,
} from "./organizationPresence";

const AWAY_DELAY_MS = 2000;

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
  const [dismissed, setDismissed] = useState<string[]>([]);
  const changing = useRef(false);
  const generation = useRef(0);
  const lastInteraction = useRef(0);
  useEffect(() => {
    if (!userId || !supabase) return;
    let active = true;
    const epoch = generation.current;
    void Promise.resolve(supabase.rpc("cg_get_required_presence_memberships"))
      .then(({ data, error }) => {
        if (!active || changing.current || generation.current !== epoch) return;
        if (error) {
          setPreferences([]);
          setError(
            "Could not load organization presence requirements. Please try again.",
          );
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
    let awayTimer: number | undefined;
    let unfocusedAt: number | null =
      document.hidden || !document.hasFocus()
        ? Date.now() - AWAY_DELAY_MS
        : null;
    lastInteraction.current = Date.now();
    const heartbeat = () => {
      if (sending) {
        sendAgain = true;
        return;
      }
      sending = true;
      const isActive =
        ((!document.hidden && document.hasFocus()) ||
          (unfocusedAt !== null && Date.now() - unfocusedAt < AWAY_DELAY_MS)) &&
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
    const focusChanged = () => {
      if (!document.hidden && document.hasFocus()) {
        clearTimeout(awayTimer);
        awayTimer = undefined;
        unfocusedAt = null;
        lastInteraction.current = Date.now();
        heartbeat();
      } else if (unfocusedAt === null) {
        unfocusedAt = Date.now();
        // Blur and visibilitychange often arrive together: start one grace period.
        awayTimer = window.setTimeout(() => {
          awayTimer = undefined;
          heartbeat();
        }, AWAY_DELAY_MS);
      }
    };
    window.addEventListener("focus", focusChanged);
    window.addEventListener("blur", focusChanged);
    document.addEventListener("visibilitychange", focusChanged);
    heartbeat();
    const timer = window.setInterval(heartbeat, 20000);
    return () => {
      active = false;
      clearInterval(timer);
      clearTimeout(awayTimer);
      for (const event of ["pointerdown", "keydown", "scroll", "touchstart"])
        document.removeEventListener(event, interact);
      window.removeEventListener("focus", focusChanged);
      window.removeEventListener("blur", focusChanged);
      document.removeEventListener("visibilitychange", focusChanged);
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
  async function acceptRequirement(org: string) {
    if (!supabase || !userId || changing.current) return;
    changing.current = true;
    const epoch = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("cg_accept_presence_requirement", {
        org,
        accepted: true,
      });
      if (error) throw new Error(error.message);
      if (generation.current !== epoch) return;
      setPreferences((previous) => [
        ...previous.filter((pref) => pref.organization_id !== org),
        {
          organization_id: org,
          organization_name:
            previous.find((pref) => pref.organization_id === org)
              ?.organization_name ?? "Organization",
          enabled: true,
          accepted: true,
        },
      ]);
      // Refresh the roster after the first heartbeat.
      setPresenceRevision((value) => value + 1);
    } catch {
      setError("Could not accept the presence requirement. Please retry.");
    } finally {
      changing.current = false;
      setBusy(false);
      setLoading(false);
      setReload((value) => value + 1);
    }
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
      if (error) throw error;
      if (generation.current !== epoch) return;
      setPreferences((previous) =>
        previous.map((pref) =>
          pref.organization_id === org ? { ...pref, enabled } : pref,
        ),
      );
      setPresenceRevision((value) => value + 1);
    } catch {
      setError("Could not save your presence setting. Please retry.");
    } finally {
      changing.current = false;
      setBusy(false);
      setReload((value) => value + 1);
    }
  }
  const pending = preferences.find(
    (pref) => !pref.accepted && !dismissed.includes(pref.organization_id),
  );
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
        reviewRequirement: (org) =>
          setDismissed((previous) => previous.filter((id) => id !== org)),
        refreshPreferences: () => setReload((value) => value + 1),
      }}
    >
      {pending && (
        <PresenceAgreement
          key={pending.organization_id}
          organizationName={pending.organization_name}
          busy={busy}
          error={error}
          onConfirm={() => void acceptRequirement(pending.organization_id)}
          onClose={() =>
            setDismissed((previous) => [...previous, pending.organization_id])
          }
        />
      )}
      {children}
    </Context.Provider>
  );
}
