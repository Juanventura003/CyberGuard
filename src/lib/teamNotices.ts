import { supabase } from "./supabase";
import { collectOrganizationPages } from "./organizationData";

export type NoticeOrganization = { id: string; name: string };
export type TeamNotice = {
  id: string;
  organization_id: string;
  article_title: string;
  article_url: string;
  article_source: string;
  guidance: string;
  pinned: boolean;
  published_at: string;
  expires_at: string | null;
  archived_at: string | null;
  acknowledged_at: string | null;
  acknowledged_count: number | null;
  member_count: number | null;
};
export type NoticePage = { total: number; notices: TeamNotice[] };

export function noticeArticleLink(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !["bleepingcomputer.com", "www.bleepingcomputer.com"].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith("/news/") ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function adminNoticeOrganizations(
  userId: string,
): Promise<NoticeOrganization[]> {
  const client = supabase;
  if (!client) return [];
  const memberships = await collectOrganizationPages<{
    organization_id: string;
  }>((from, to) =>
    client
      .from("cg_memberships")
      .select("organization_id", { count: "exact" })
      .eq("user_id", userId)
      .eq("role", "admin")
      .order("organization_id")
      .range(from, to),
  );
  if (!memberships.length) return [];
  return collectOrganizationPages<NoticeOrganization>((from, to) =>
    client
      .from("cg_organizations")
      .select("id,name", { count: "exact" })
      .is("archived_at", null)
      .in(
        "id",
        memberships.map((member) => member.organization_id),
      )
      .order("id")
      .range(from, to),
  );
}

export async function listTeamNotices(
  org: string,
  includeInactive: boolean,
  page: number,
): Promise<NoticePage> {
  if (!supabase) throw new Error("Team notices are unavailable.");
  const { data, error } = await supabase.rpc("cg_list_team_notices", {
    org,
    include_inactive: includeInactive,
    page_offset: page * 10,
  });
  if (error) throw error;
  return data as NoticePage;
}
