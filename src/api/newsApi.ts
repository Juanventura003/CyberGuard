import { API_BASE } from "./emailApi";
import { supabase } from "../lib/supabase";

export type NewsCategory =
  "Phishing" | "Malware" | "Breaches" | "Vulnerabilities" | "General";
export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  published_at: string;
  category: NewsCategory;
}
export interface NewsResponse {
  articles: NewsArticle[];
  fetched_at: string;
  source_url: string;
  stale: boolean;
}

export async function fetchNews(signal: AbortSignal): Promise<NewsResponse> {
  const response = await fetch(`${API_BASE}/api/news`, { signal });
  if (!response.ok) throw new Error("Could not load news. Please try again.");
  return response.json();
}

export interface NewsActivity {
  article: NewsArticle;
  saved: boolean;
  read: boolean;
}

export async function fetchNewsActivity(
  userId: string,
): Promise<NewsActivity[]> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("news_activity")
    .select("article, saved, read")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function updateNewsActivity(
  userId: string,
  article: NewsArticle,
  change: { saved: boolean; read: boolean },
): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("news_activity").upsert(
    {
      user_id: userId,
      article_id: article.id,
      article,
      ...change,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,article_id", defaultToNull: false },
  );

  if (error) throw error;
}
