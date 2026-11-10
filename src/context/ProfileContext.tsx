import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { supabase } from "../lib/supabase";

export interface Profile {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface ProfileContextType {
  profile: Profile | null;
  displayName: string;
  setProfile: (changes: Partial<Profile>) => void;
}

interface LoadedProfile {
  userId: string;
  profile: Profile | null;
}

const EMPTY_PROFILE: Profile = {
  first_name: null,
  last_name: null,
  username: null,
  avatar_url: null,
};

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
        .select("first_name, last_name, username, avatar_url")
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

  const setProfile = (changes: Partial<Profile>) => {
    if (!userId) return;
    setLoaded((previous) => ({
      userId,
      profile: {
        ...EMPTY_PROFILE,
        ...(previous && previous.userId === userId ? previous.profile : null),
        ...changes,
      },
    }));
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