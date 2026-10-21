import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { supabase } from "../lib/supabase";

export interface Profile {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}

interface ProfileContextType {
  profile: Profile | null;
  displayName: string;
  setProfile: (profile: Profile) => void;
}

interface LoadedProfile {
  userId: string;
  profile: Profile | null;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [loaded, setLoaded] = useState<LoadedProfile | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!userId || !client) return;
    let cancelled = false;

    const loadProfile = async () => {
      const { data } = await client
        .from("profiles")
        .select("first_name, last_name, username")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;
      setLoaded({ userId, profile: data });
    };

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const profile = loaded && loaded.userId === userId ? loaded.profile : null;

  const setProfile = (next: Profile) => {
    if (!userId) return;
    setLoaded({ userId, profile: next });
  };

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const displayName = fullName || profile?.username || user?.email || "";

  return (
    <ProfileContext.Provider value={{ profile, displayName, setProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
}