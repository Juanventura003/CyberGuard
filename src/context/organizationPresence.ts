import { createContext, useContext } from "react";

export type Preference = { organization_id: string; enabled: boolean };
export type PresenceContext = {
  forgetOrganization: (org: string) => void;
  presenceRevision: number;
  preferences: Preference[];
  loading: boolean;
  busy: boolean;
  error: string;
  setSharing: (org: string, enabled: boolean) => Promise<void>;
};
export const OrganizationPresenceContext =
  createContext<PresenceContext | null>(null);

export function useOrganizationPresence(org: string) {
  const context = useContext(OrganizationPresenceContext);
  if (!context) throw new Error("Organization presence provider is missing.");
  return {
    ...context,
    sharing: context.preferences.some(
      (pref) => pref.organization_id === org && pref.enabled,
    ),
  };
}
